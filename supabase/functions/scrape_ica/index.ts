// Wrapper for ICA scraper using shared createScraper; delegates logic to logic.ts
import { createScraper, type ScrapeContext, type ScrapeResult } from "../_shared/create-scraper.ts";
import { upsertScreenings } from "../_shared/scraper-helpers.ts";
import { collectIcaRows } from "../_shared/collectors/ica.ts";

async function scrapeIca({ userAgent }: ScrapeContext): Promise<ScrapeResult> {
  const rows = await collectIcaRows(userAgent);
  const { inserted } = await upsertScreenings(rows);
  return { scraped: rows.length, inserted };
}

createScraper(scrapeIca);
