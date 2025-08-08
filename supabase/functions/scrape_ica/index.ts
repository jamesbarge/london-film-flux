// ICA scraper Edge Function using shared helpers and template
// Fetches ICA cinema events, extracts screenings, and upserts into DB

import { load } from "npm:cheerio@1.0.0-rc.12";
import {
  fetchHtml,
  toLondonISO,
  detectFormats,
  makeId,
  upsertScreenings,
  type ScreeningRow,
} from "../_shared/scraper-helpers.ts";
import { createScraper, type ScrapeContext, type ScrapeResult } from "../_shared/create-scraper.ts";

const LIST_URL = "https://www.ica.art/whats-on/cinema";
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
  } catch {
    // ignore malformed JSON-LD
  }
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

  if (jsonLdEvents.length > 0) {
    return jsonLdEvents;
  }

  // Fallback parsing
  const title = $("h1").first().text().trim();
  if (!title) return null;

  const times = new Set<string>();
  $("time[datetime]").each((_, el) => {
    const dt = $(el).attr("datetime")?.trim();
    if (dt) times.add(toLondonISO(dt));
  });

  // Try to find booking links
  const bookHref = $("a[href*='ticket'], a[href*='book'], a[href*='buy']").first().attr("href");
  const bookingUrl = resolveUrl(bookHref, url) || url;

  if (times.size === 0) return null;

  const rows: ScreeningRow[] = Array.from(times).map((iso) => ({
    id: makeId(VENUE_ID, iso, title),
    title,
    venue_id: VENUE_ID,
    start_at: iso,
    format: formats,
    booking_url: bookingUrl,
    source_url: url,
  }));

  return rows;
}

async function scrapeIca({ userAgent }: ScrapeContext): Promise<ScrapeResult> {
  // 1) Fetch list page and collect event links
  const listHtml = await fetchHtml(LIST_URL, userAgent);
  const $ = load(listHtml);
  const linkSet = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!/\/whats-on\//.test(href)) return;
    const full = resolveUrl(href, LIST_URL);
    if (!full) return;
    // Skip the generic cinema list page itself
    if (/\/whats-on\/cinema\/?$/.test(full)) return;
    linkSet.add(full);
  });

  const links = Array.from(linkSet).slice(0, 200); // safety cap

  // 2) For each event page, parse events
  const allRows: ScreeningRow[] = [];
  for (const url of links) {
    try {
      const rows = await scrapeEventPage(url, userAgent);
      if (rows && rows.length > 0) allRows.push(...rows);
    } catch (e) {
      console.warn("Failed to scrape page", url, e);
    }
  }

  // 3) Deduplicate by id
  const dedup = new Map<string, ScreeningRow>();
  for (const row of allRows) dedup.set(row.id, row);
  const uniqueRows = Array.from(dedup.values());

  // 4) Upsert
  const { inserted } = await upsertScreenings(uniqueRows);

  return { scraped: uniqueRows.length, inserted };
}

createScraper(scrapeIca);
