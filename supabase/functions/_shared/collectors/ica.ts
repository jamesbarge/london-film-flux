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

const LIST_URL = "https://www.ica.art/whats-on"; // no /cinema, that 404s
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

  const title = $("h1").first().text().trim();
  if (!title) return null;

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

  // collect candidate links from cards and inline links
  const links = new Set<string>();
  $('a[href*="/whats-on/"]').each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = $(a).text().trim().toLowerCase();

    // only keep items that look like cinema events
    const tag = $(a).closest("[class*='card'], article, li").text().toLowerCase();
    const isCinema = tag.includes("cinema") || text.includes("cinema");

    if (isCinema && href && !href.endsWith("#")) {
      links.add(href.startsWith("http") ? href : new URL(href, "https://www.ica.art").toString());
    }
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
