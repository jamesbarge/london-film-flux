// Shared helpers for scrapers used by Edge Functions
// Deno/Edge compatible utilities only (no Node APIs)

// Supabase client for Edge Functions (Deno ESM import)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Timezone helpers (date-fns-tz v3 with named exports per release notes)
import { fromZonedTime } from "npm:date-fns-tz@3.0.0";

export type ScreeningRow = {
  id: string;
  title: string;
  director?: string;
  year?: number;
  venue_id: string; // maps to cinemas.id
  start_at: string; // ISO string (UTC) for screenings.start_time
  format?: string;
  booking_url: string;
  source_url: string;
  notes?: string;
};

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function fetchHtml(
  url: string,
  userAgent =
    "London Rep Listings Bot/1.0 (+https://lovable.dev); polite crawler"
): Promise<string> {
  const maxRetries = 3;
  const baseDelay = 400; // ms
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} fetching ${url}`);
      }
      const html = await resp.text();
      return html;
    } catch (err) {
      lastError = err;
      // small polite backoff with jitter
      const delay = baseDelay * (attempt + 1) + Math.random() * 200;
      await sleep(delay);
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

// Convert a Date or date-like text to an ISO string representing the UTC instant
// when interpreting the time in the Europe/London time zone for naive inputs.
export function toLondonISO(input: string | Date): string {
  if (typeof input === "string") {
    const hasTZ = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
    if (hasTZ) {
      return new Date(input).toISOString();
    }
    // Treat naive strings as London local time
    const d = new Date(input);
    return fromZonedTime(d, "Europe/London").toISOString();
  }
  // If a Date is supplied, assume it's already an absolute instant
  return new Date(input).toISOString();
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function makeId(prefix: string, iso: string, title: string): string {
  const timeKey = iso.replace(/[-:TZ.]/g, "").slice(0, 12); // YYYYMMDDHHMM
  return `${slugify(prefix)}-${timeKey}-${slugify(title)}`;
}

export function detectFormats(text: string): string[] {
  const t = text.toLowerCase();
  const out = new Set<string>();

  if (/(^|[^\d])35\s?mm([^\d]|$)/.test(t)) out.add("35 mm");
  if (/(^|[^\d])70\s?mm([^\d]|$)/.test(t)) out.add("70 mm");
  if (/(^|[^\d])16\s?mm([^\d]|$)/.test(t)) out.add("16 mm");
  if (/\bq\s*(?:&|and)?\s*a\b|q\s*&\s*a|q&a|q\s*\+\s*a/.test(t)) out.add("Q and A");
  if (/\b(subtitled|subtitles|captioned|captions|hoh)\b/.test(t)) out.add("Subtitled");
  if (/\b4k\b|\b4k\s*restoration\b/.test(t)) out.add("4K");
  if (/\bimax\b/.test(t)) out.add("IMAX");

  return Array.from(out);
}

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getOrCreateFilm(
  supabase: SupabaseClient,
  title: string,
  year?: number
): Promise<string> {
  // Try to find by (title, year) if year provided; else by title only
  const query = supabase
    .from("films")
    .select("id")
    .eq("title", title)
    .limit(1);
  const { data: foundByTitle, error: findErr1 } = year
    ? await query.eq("year", year)
    : await query;
  if (findErr1) throw findErr1;
  if (foundByTitle && foundByTitle.length > 0) return foundByTitle[0].id as string;

  const { data: inserted, error: insErr } = await supabase
    .from("films")
    .insert({ title, year: year ?? null })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted!.id as string;
}

export async function upsertScreenings(rows: ScreeningRow[]) {
  if (!rows || rows.length === 0) return { inserted: 0, errors: [] as Array<{ id: string; error: string }> };

  const supabase = getServiceClient();
  const errors: Array<{ id: string; error: string }> = [];
  let successCount = 0;

  for (const row of rows) {
    try {
      const filmId = await getOrCreateFilm(supabase, row.title, row.year);

      const payload = {
        id: row.id,
        cinema_id: row.venue_id,
        film_id: filmId,
        start_time: row.start_at,
        end_time: null as string | null,
        screen: null as string | null,
      };

      const { error: upsertErr } = await supabase
        .from("screenings")
        .upsert(payload, { onConflict: "id" });

      if (upsertErr) throw upsertErr;
      successCount++;
    } catch (e: any) {
      errors.push({ id: row.id, error: e?.message ?? String(e) });
    }
  }

  return { inserted: successCount, errors };
}

// Note: When you need HTML parsing, import cheerio at call sites:
// import { load } from "npm:cheerio@1.0.0-rc.12";
