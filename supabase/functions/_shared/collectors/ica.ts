// ICA collector: parses ICA events and returns ScreeningRow[] (no upsert, no Deno.serve)

import { load } from "npm:cheerio@1.0.0-rc.12";
import {
  fetchHtml,
  toLondonISO,
  detectFormats,
  makeId,
  sleep,
  type ScreeningRow,
} from "../scraper-helpers.ts";

const LIST_URL = "https://www.ica.art/films"; // current films listings
const VENUE_ID = "ica";

function resolveUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function extractEventsFromJsonLd(jsonText: string): Array<{ name?: string; startDate?: string; url?: string; offersUrl?: string }> {
  const out: Array<{ name?: string; startDate?: string; url?: string; offersUrl?: string }> = [];
  try {
    const data = JSON.parse(jsonText);
    const items: any[] = Array.isArray(data)
      ? data
      : Array.isArray((data as any)["@graph"]) ? (data as any)["@graph"] : [data];
    for (const item of items) {
      const t = item?.["@type"];
      const types = Array.isArray(t) ? t.map((x) => String(x).toLowerCase()) : [String(t ?? "").toLowerCase()];
      if (types.includes("event")) {
        const name = item?.name ?? item?.headline;
        const startDate = item?.startDate ?? item?.startTime ?? item?.start;
        let offersUrl: string | undefined = undefined;
        const offers = item?.offers;
        if (offers) {
          if (Array.isArray(offers)) {
            offersUrl = offers.find((o: any) => o?.url)?.url || offers[0]?.url;
          } else if (typeof offers === "object") {
            offersUrl = offers.url;
          }
        }
        const url = item?.url;
        out.push({ name, startDate, url, offersUrl });
      }
    }
  } catch {}
  return out;
}

async function scrapeEventPage(url: string, userAgent: string): Promise<ScreeningRow[] | null> {
  const html = await fetchHtml(url, userAgent);
  const $ = load(html);

  const pageText = $("body").text();
  const formats = detectFormats(pageText).join(", ") || undefined;

  const jsonLdEvents: ScreeningRow[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    const events = extractEventsFromJsonLd(txt);
    for (const e of events) {
      if (!e.name || !e.startDate) continue;
      const iso = toLondonISO(e.startDate);
      const booking = resolveUrl(e.offersUrl || e.url, url) || url;
      jsonLdEvents.push({
        id: makeId(VENUE_ID, iso, e.name),
        title: e.name,
        venue_id: VENUE_ID,
        start_at: iso,
        format: formats,
        booking_url: booking,
        source_url: url,
      });
    }
  });
  if (jsonLdEvents.length > 0) return jsonLdEvents;

  // Prefer explicit title element ICA uses; fallback to h1
  const title = $("#title .title").first().text().trim() || $("h1").first().text().trim();
  if (!title) return null;

  // ICA page structure: list of .performance entries with .date and .time
  const perfRows: ScreeningRow[] = [];
  const monthMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  $(".performance").each((_, el) => {
    const dateTxt = $(el).find(".date").text().trim(); // e.g., "Tue, 19 Aug 2025"
    const timeTxt = $(el).find(".time").text().trim(); // e.g., "04:10 pm"
    const m = dateTxt.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    const t = timeTxt.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!m || !t) return;
    const day = m[1].padStart(2, "0");
    const mon = monthMap[m[2].toLowerCase() as keyof typeof monthMap];
    const year = m[3];
    let hour = parseInt(t[1], 10);
    const minute = t[2];
    const ampm = t[3].toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, "0");
    const iso = toLondonISO(`${year}-${mon}-${day}T${hh}:${minute}:00`);
    perfRows.push({
      id: makeId(VENUE_ID, iso, title),
      title,
      venue_id: VENUE_ID,
      start_at: iso,
      format: formats,
      booking_url: url, // page-level booking widget; fallback to source URL
      source_url: url,
    });
  });
  if (perfRows.length > 0) return perfRows;

  // Fallback: semantic <time datetime> (older pages)
  const times = new Set<string>();
  $("time[datetime]").each((_, el) => {
    const dt = $(el).attr("datetime")?.trim();
    if (dt) times.add(toLondonISO(dt));
  });

  const bookHref = $("a[href*='ticket'], a[href*='book'], a[href*='buy']").first().attr("href");
  const bookingUrl = resolveUrl(bookHref, url) || url;

  if (times.size === 0) return null;

  return Array.from(times).map((iso) => ({
    id: makeId(VENUE_ID, iso, title),
    title,
    venue_id: VENUE_ID,
    start_at: iso,
    format: formats,
    booking_url: bookingUrl,
    source_url: url,
  }));
}

export async function collectIcaRows(userAgent: string): Promise<ScreeningRow[]> {
  const rows: ScreeningRow[] = [];

  // fetch list page with simple fallback (with and without trailing slash)
  const listCandidates = [
    LIST_URL,
    LIST_URL.endsWith("/") ? LIST_URL.slice(0, -1) : `${LIST_URL}/`,
  ];

  let html = "";
  let fetchedFrom = "";
  for (const u of listCandidates) {
    try {
      html = await fetchHtml(u, userAgent);
      fetchedFrom = u;
      break;
    } catch (e) {
      console.warn("ICA list fetch failed", { url: u, e: String(e) });
    }
  }
  if (!html) {
    console.error("ICA list fetch gave no HTML after fallbacks", { tried: listCandidates });
    return [];
  }
  console.log("ICA list fetch ok", { url: fetchedFrom, len: html.length });

  const $ = load(html);

  // collect candidate links from Films page
  const links = new Set<string>();
  $('a[href*="/films/"]').each((_, a) => {
    const href = $(a).attr("href")?.trim() || "";
    if (!href || href.endsWith("#")) return;
    const absolute = href.startsWith("http") ? href : new URL(href, "https://www.ica.art").toString();
    // skip the index listing itself
    if (/\/films\/?$/.test(absolute)) return;
    links.add(absolute);
  });

  const samples = Array.from(links).slice(0, 3);
  console.log("ICA candidate links", { count: links.size, samples });

  // visit each event page using the robust parser
  for (const url of links) {
    try {
      const events = await scrapeEventPage(url, userAgent);
      const add = events?.length ?? 0;
      if (add > 0) rows.push(...(events as ScreeningRow[]));
      console.log("ICA page parsed", { url, added: add });
      await sleep(350);
    } catch (e) {
      console.warn("ICA page error", { url, e: String(e) });
    }
  }

  // de dup by id
  const map = new Map(rows.map((r) => [r.id, r]));
  const deduped = Array.from(map.values());
  console.log("ICA total rows", { before: rows.length, after: deduped.length });
  return deduped;
}
