// Wrapper for BFI Southbank scraper using shared createScraper; delegates logic to logic.ts
import { createScraper, type ScrapeContext, type ScrapeResult } from "../_shared/create-scraper.ts";
import { upsertScreenings } from "../_shared/scraper-helpers.ts";
import { collectBfiRows } from "./logic.ts";

async function scrapeBfi({ userAgent }: ScrapeContext): Promise<ScrapeResult> {
  const rows = await collectBfiRows(userAgent);
  const { inserted } = await upsertScreenings(rows);
  return { scraped: rows.length, inserted };
}

createScraper(scrapeBfi);
