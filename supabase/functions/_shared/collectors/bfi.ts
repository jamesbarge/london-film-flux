// BFI Southbank collector: parses Calendar/programme pages and returns ScreeningRow[]

import { load } from "npm:cheerio@1.0.0-rc.12";
import {
  fetchHtml,
  toLondonISO,
  detectFormats,
  makeId,
  type ScreeningRow,
} from "../scraper-helpers.ts";

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
      out.push({
        id: makeId(VENUE_ID, iso, name),
        title: name,
        venue_id: VENUE_ID,
        start_at: iso,
        format: undefined,
        booking_url: booking,
        source_url: pageUrl,
      });
    }
  } catch {}
  return out;
}

async function parseDetailPage(detailUrl: string, userAgent: string): Promise<ScreeningRow[] | null> {
  const html = await fetchHtml(detailUrl, userAgent);
  const $ = load(html);

  let rows: ScreeningRow[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    const events = extractEventsFromJsonLd(txt, detailUrl);
    rows.push(...events);
  });

  if (rows.length > 0) {
    const pageText = $("body").text();
    const fmts = detectFormats(pageText).join(", ") || undefined;
    rows = rows.map((r) => ({ ...r, format: r.format ?? fmts }));
    return rows;
  }

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

function extractFromCard($: any, card: any, baseUrl: string) {
  const $card = $(card);
  const title = ($card.find("h3,h2,.title,[itemprop='name']").first().text() || $card.attr("aria-label") || "").trim();

  const timeAttr = $card.find("time[datetime]").first().attr("datetime")?.trim();
  const iso = timeAttr ? toLondonISO(timeAttr) : undefined;

  const bookHref = $card.find("a[href*='ticket'], a[href*='book'], a[href*='buy']").first().attr("href");
  const anyLink = $card.find("a[href]").first().attr("href");
  const booking = resolveUrl(bookHref, baseUrl);
  const detail = resolveUrl(anyLink, baseUrl);

  const formats = detectFormats($card.text()).join(", ") || undefined;

  if (!title && !iso && !detail) return null as any;
  return { title: title || undefined, iso, booking: booking || undefined, detail: detail || undefined, formats };
}

async function parseCardsOnPage(url: string, userAgent: string): Promise<ScreeningRow[]> {
  const html = await fetchHtml(url, userAgent);
  const $ = load(html);

  const jsonldRows: ScreeningRow[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    jsonldRows.push(...extractEventsFromJsonLd(txt, url));
  });
  if (jsonldRows.length > 0) {
    const pageText = $("body").text();
    const fmts = detectFormats(pageText).join(", ") || undefined;
    return jsonldRows.map((r) => ({ ...r, format: r.format ?? fmts }));
  }

  const rows: ScreeningRow[] = [];
  const cards = $("article, .card, .event, .event-card, li, [itemtype*='Event']");
  for (const el of cards.toArray()) {
    const info = extractFromCard($, el, url);
    if (!info) continue;

    if ((!info.title || !info.iso) && info.detail) {
      try {
        const detailRows = await parseDetailPage(info.detail, userAgent);
        if (detailRows && detailRows.length) {
          rows.push(...detailRows);
          continue;
        }
      } catch {}
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

async function firecrawlDiscoverLinks(startUrl: string, limit: number): Promise<string[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/crawl", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: startUrl,
        limit,
        scrapeOptions: { formats: ["html"] },
      }),
    });
    if (!res.ok) {
      console.error("Firecrawl discovery failed", { status: res.status });
      return [];
    }
    const data: any = await res.json();
    const items: any[] = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);

    const out = new Set<string>();
    for (const it of items) {
      const pageUrl: string | undefined = it?.url || it?.metadata?.url || it?.source?.url;
      if (pageUrl && /^https:\/\/whatson\.bfi\.org\.uk\//.test(pageUrl) && /\/southbank\//i.test(pageUrl) && !/\/southbank\/Calendar(\/?|\b)/i.test(pageUrl)) {
        out.add(pageUrl);
      }
      const html: string | undefined = it?.html || it?.content || it?.markdown;
      if (typeof html === "string" && html) {
        try {
          const $ = load(html);
          $("a[href]").each((_, el) => {
            const href = $(el).attr("href") || "";
            const full = resolveUrl(href, pageUrl || startUrl);
            if (!full) return;
            if (!/^https:\/\/whatson\.bfi\.org\.uk\//.test(full)) return;
            if (/\/southbank\/Calendar(\/?|\b)/i.test(full)) return;
            if (/\/southbank\//i.test(full)) out.add(full);
          });
        } catch {}
      }
    }
    const arr = Array.from(out).slice(0, 200);
    console.warn("Firecrawl discovery collected links", { count: arr.length });
    return arr;
  } catch (e) {
    console.error("Firecrawl discovery error", { error: (e as Error)?.message });
    return [];
  }
}

export async function collectBfiRows(userAgent: string): Promise<ScreeningRow[]> {
  const startUrls = [
    LIST_URL,
    "https://whatson.bfi.org.uk/southbank/",
    "https://whatson.bfi.org.uk/",
  ];

  let listHtml: string | null = null;
  let firstErr: any = null;
  for (const u of startUrls) {
    try {
      listHtml = await fetchHtml(u, userAgent);
      if (listHtml) break;
    } catch (e) {
      firstErr = firstErr ?? e;
    }
  }

  const linkSet = new Set<string>();

  if (listHtml) {
    const $ = load(listHtml);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const full = resolveUrl(href, LIST_URL);
      if (!full) return;
      if (!/^https:\/\/whatson\.bfi\.org\.uk\//.test(full)) return;
      if (/\/southbank\/Calendar(\/?|\b)/i.test(full)) return;
      if (/\/southbank\//i.test(full)) linkSet.add(full);
    });
    linkSet.add(LIST_URL);
  } else {
    if (Deno.env.get("FIRECRAWL_API_KEY")) {
      console.warn("BFI: using Firecrawl discovery fallback");
      const discovered = await firecrawlDiscoverLinks("https://whatson.bfi.org.uk/southbank/", 30);
      for (const l of discovered) linkSet.add(l);
      if (linkSet.size === 0) throw firstErr ?? new Error("Failed to load BFI listing pages (no links discovered)");
    } else {
      throw firstErr ?? new Error("Failed to load BFI listing pages");
    }
  }

  const links = Array.from(linkSet).slice(0, 250);

  const allRows: ScreeningRow[] = [];
  for (const url of links) {
    try {
      const rows = await parseCardsOnPage(url, userAgent);
      if (rows && rows.length > 0) allRows.push(...rows);
    } catch {}
  }

  const dedup = new Map<string, ScreeningRow>();
  for (const r of allRows) dedup.set(r.id, r);
  return Array.from(dedup.values());
}
