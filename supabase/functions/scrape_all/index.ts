// Aggregate scraper that runs all venue collectors with small delays, merges and upserts once // redeploy

import { createScraper, type ScrapeContext } from "../_shared/create-scraper.ts";
import { upsertScreenings, sleep, type ScreeningRow } from "../_shared/scraper-helpers.ts";
import { collectIcaRows } from "../_shared/collectors/ica.ts";
import { collectBfiRows } from "../_shared/collectors/bfi.ts";

async function scrapeAll({ userAgent }: ScrapeContext): Promise<any> {
  const perVenue: Record<string, ScreeningRow[]> = {};

  // ICA
  const icaRows = await collectIcaRows(userAgent);
  perVenue["ica"] = icaRows;
  await sleep(400);

  // BFI Southbank
  const bfiRows = await collectBfiRows(userAgent);
  perVenue["bfi-southbank"] = bfiRows;
  await sleep(400);

  // Merge and dedupe by id
  const merged: ScreeningRow[] = [...icaRows, ...bfiRows];
  const dedup = new Map<string, ScreeningRow>();
  for (const r of merged) dedup.set(r.id, r);
  const uniqueRows = Array.from(dedup.values());

  const { inserted } = await upsertScreenings(uniqueRows);

  const counts = Object.fromEntries(Object.entries(perVenue).map(([k, v]) => [k, v.length]));
  const total = uniqueRows.length;

  return { scraped: total, inserted, counts, total };
}

createScraper(scrapeAll);
