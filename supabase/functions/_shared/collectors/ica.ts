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

  // fetch list page
  const html = await fetchHtml(LIST_URL, userAgent);
  console.log("ICA list fetch ok", { url: LIST_URL, len: html.length });

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

  console.log("ICA candidate links", { count: links.size });

  // visit each event page, prefer JSON-LD Event
  for (const url of links) {
    try {
      const page = await fetchHtml(url, userAgent);
      const $$ = load(page);

      let added = 0;

      $$('script[type="application/ld+json"]').each((_, s) => {
        try {
          const data = JSON.parse($$(s).text());
          const arr = Array.isArray(data) ? data : [data];
          for (const it of arr) {
            if (it && it["@type"] === "Event" && it.name && it.startDate) {
              const title = String(it.name).trim();
              const iso = toLondonISO(it.startDate);
              const book = it.offers?.url || it.url || url;

              rows.push({
                id: makeId("ica", iso, title),
                title,
                venue_id: "ica",
                start_at: iso,
                format: detectFormats(JSON.stringify(it)),
                booking_url: book.startsWith("http") ? book : new URL(book, url).toString(),
                source_url: url,
              });
              added++;
            }
          }
        } catch {}
      });

      // fallback to DOM if no JSON LD
      if (added === 0) {
        const title = $$("h1").first().text().trim();
        const pageText = $$("body").text();
        $$("time[datetime]").each((_, t) => {
          const dt = $$(t).attr("datetime");
          if (!dt || !title) return;
          const iso = toLondonISO(dt);
          const book =
            $$('a[href*="ticket"], a[href*="book"], a[href*="buy"]').first().attr("href") || url;

          rows.push({
            id: makeId("ica", iso, title),
            title,
            venue_id: "ica",
            start_at: iso,
            format: detectFormats(pageText),
            booking_url: book?.startsWith("http") ? book : new URL(book || "", url).toString(),
            source_url: url,
          });
          added++;
        });
      }

      console.log("ICA page parsed", { url, added });
      await sleep(350);
    } catch (e) {
      console.warn("ICA page error", { url, e: String(e) });
    }
  }

  // de dup by id
  const map = new Map(rows.map(r => [r.id, r]));
  return Array.from(map.values());
}
