// BFI Southbank scraper Edge Function
// Scrapes the Calendar page and any linked programme/detail pages

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

const LIST_URL = "https://whatson.bfi.org.uk/southbank/Calendar";
const VENUE_ID = "bfi-southbank";

function resolveUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function extractEventsFromJsonLd(jsonText: string, pageUrl: string): ScreeningRow[] {
  const out: ScreeningRow[] = [];
  try {
    const data = JSON.parse(jsonText);
    const items: any[] = Array.isArray(data)
      ? data
      : Array.isArray((data as any)["@graph"]) ? (data as any)["@graph"] : [data];
    for (const item of items) {
      const t = item?.["@type"];
      const types = Array.isArray(t) ? t.map((x) => String(x).toLowerCase()) : [String(t ?? "").toLowerCase()];
      if (!types.includes("event")) continue;

      const name: string | undefined = item?.name ?? item?.headline;
      const startDate: string | undefined = item?.startDate ?? item?.startTime ?? item?.start;

      let offersUrl: string | undefined = undefined;
      const offers = item?.offers;
      if (offers) {
        if (Array.isArray(offers)) {
          offersUrl = offers.find((o: any) => o?.url)?.url || offers[0]?.url;
        } else if (typeof offers === "object") {
          offersUrl = offers.url;
        }
      }
      const url: string | undefined = item?.url;

      if (!name || !startDate) continue;
      const iso = toLondonISO(startDate);
      const booking = resolveUrl(offersUrl || url, pageUrl) || pageUrl;
      const formats = undefined; // We'll compute formats from page text where applicable separately

      out.push({
        id: makeId(VENUE_ID, iso, name),
        title: name,
        venue_id: VENUE_ID,
        start_at: iso,
        format: formats,
        booking_url: booking,
        source_url: pageUrl,
      });
    }
  } catch {
    // ignore malformed JSON-LD
  }
  return out;
}

async function parseDetailPage(detailUrl: string, userAgent: string): Promise<ScreeningRow[] | null> {
  const html = await fetchHtml(detailUrl, userAgent);
  const $ = load(html);

  // Prefer JSON-LD events
  let rows: ScreeningRow[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    const events = extractEventsFromJsonLd(txt, detailUrl);
    rows.push(...events);
  });

  if (rows.length > 0) {
    // Attempt to enrich with formats from the visible text
    const pageText = $("body").text();
    const fmts = detectFormats(pageText).join(", ") || undefined;
    rows = rows.map((r) => ({ ...r, format: r.format ?? fmts }));
    return rows;
  }

  // Fallback: title + times + booking link
  const title = ($("h1").first().text() || $("[itemprop='name']").first().text()).trim();
  if (!title) return null;

  const times = new Set<string>();
  $("time[datetime]").each((_, el) => {
    const dt = $(el).attr("datetime")?.trim();
    if (dt) times.add(toLondonISO(dt));
  });
  if (times.size === 0) return null;

  const pageText = $("body").text();
  const formats = detectFormats(pageText).join(", ") || undefined;

  const bookHref = $("a[href*='ticket'], a[href*='book'], a[href*='buy']").first().attr("href");
  const booking = resolveUrl(bookHref, detailUrl) || detailUrl;

  return Array.from(times).map((iso) => ({
    id: makeId(VENUE_ID, iso, title),
    title,
    venue_id: VENUE_ID,
    start_at: iso,
    format: formats,
    booking_url: booking,
    source_url: detailUrl,
  }));
}

function extractFromCard($: cheerio.CheerioAPI, card: cheerio.Element, baseUrl: string): {
  title?: string;
  iso?: string;
  booking?: string;
  detail?: string;
  formats?: string;
} | null {
  const $card = $(card);
  const title = ($card.find("h3,h2,.title,[itemprop='name']").first().text() || $card.attr("aria-label") || "").trim();

  const timeAttr = $card.find("time[datetime]").first().attr("datetime")?.trim();
  const iso = timeAttr ? toLondonISO(timeAttr) : undefined;

  const bookHref = $card.find("a[href*='ticket'], a[href*='book'], a[href*='buy']").first().attr("href");
  const anyLink = $card.find("a[href]").first().attr("href");
  const booking = resolveUrl(bookHref, baseUrl);
  const detail = resolveUrl(anyLink, baseUrl);

  const formats = detectFormats($card.text()).join(", ") || undefined;

  if (!title && !iso && !detail) return null;
  return { title: title || undefined, iso, booking: booking || undefined, detail: detail || undefined, formats };
}

async function parseCardsOnPage(url: string, userAgent: string): Promise<ScreeningRow[]> {
  const html = await fetchHtml(url, userAgent);
  const $ = load(html);

  // First try JSON-LD at page level
  const jsonldRows: ScreeningRow[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    jsonldRows.push(...extractEventsFromJsonLd(txt, url));
  });
  if (jsonldRows.length > 0) {
    // Enrich formats with page text
    const pageText = $("body").text();
    const fmts = detectFormats(pageText).join(", ") || undefined;
    return jsonldRows.map((r) => ({ ...r, format: r.format ?? fmts }));
  }

  // Otherwise, iterate candidate card containers
  const rows: ScreeningRow[] = [];
  const cards = $("article, .card, .event, .event-card, li, [itemtype*='Event']");
  for (const el of cards.toArray()) {
    const info = extractFromCard($, el, url);
    if (!info) continue;

    // If missing crucial info, try to follow detail page
    if ((!info.title || !info.iso) && info.detail) {
      try {
        const detailRows = await parseDetailPage(info.detail, userAgent);
        if (detailRows && detailRows.length) {
          rows.push(...detailRows);
          continue;
        }
      } catch {
        // ignore and fallback to what we have
      }
    }

    if (!info.title || !info.iso) continue;

    rows.push({
      id: makeId(VENUE_ID, info.iso, info.title),
      title: info.title,
      venue_id: VENUE_ID,
      start_at: info.iso,
      format: info.formats,
      booking_url: info.booking || info.detail || url,
      source_url: info.detail || url,
    });
  }

  return rows;
}

async function scrapeBfi({ userAgent }: ScrapeContext): Promise<ScrapeResult> {
  // 1) Fetch Calendar page and collect candidate links
  const listHtml = await fetchHtml(LIST_URL, userAgent);
  const $ = load(listHtml);
  const linkSet = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const full = resolveUrl(href, LIST_URL);
    if (!full) return;
    // Same domain, likely programme or detail pages
    if (!/^https:\/\/whatson\.bfi\.org\.uk\//.test(full)) return;
    // Skip calendar itself and irrelevant anchors
    if (/\/southbank\/Calendar(\/?|\b)/i.test(full)) return;
    // Keep programme/detail pages under /southbank
    if (/\/southbank\//i.test(full)) linkSet.add(full);
  });

  // Always include the Calendar page itself for direct cards
  linkSet.add(LIST_URL);

  const links = Array.from(linkSet).slice(0, 250); // safety cap

  // 2) Parse each page for screening cards / JSON-LD events
  const allRows: ScreeningRow[] = [];
  for (const url of links) {
    try {
      const rows = await parseCardsOnPage(url, userAgent);
      if (rows && rows.length > 0) allRows.push(...rows);
    } catch (e) {
      console.warn("Failed to parse page", url, e);
    }
  }

  // 3) Deduplicate by id
  const dedup = new Map<string, ScreeningRow>();
  for (const row of allRows) dedup.set(row.id, row);
  const uniqueRows = Array.from(dedup.values());

  // 4) Upsert into DB
  const { inserted } = await upsertScreenings(uniqueRows);

  return { scraped: uniqueRows.length, inserted };
}

createScraper(scrapeBfi);
