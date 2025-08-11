
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fromZonedTime } from "npm:date-fns-tz@3.0.0";

export type ScreeningRow = {
  id: string;
  title: string;
  director?: string;
  year?: number;
  venue_id: string; // venue slug (e.g., "ica", "bfi-southbank")
  start_at: string; // ISO string (UTC) for screenings.start_time
  format?: string;
  booking_url: string;
  source_url: string;
  notes?: string;
};

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Firecrawl fallback for blocked pages (403/429) or exhausted retries
async function fetchViaFirecrawl(url: string): Promise<string> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

  console.warn("fetchHtml: using Firecrawl fallback", { url });

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
      onlyMainContent: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl HTTP ${res.status}`);
  }

  // Try to robustly extract HTML from various possible response shapes
  const data: any = await res.json();
  const candidates = [
    data?.data?.html,
    Array.isArray(data?.data) ? data?.data?.[0]?.html : undefined,
    data?.html,
    Array.isArray(data) ? data?.[0]?.html : undefined,
    data?.data?.content,
    data?.content,
  ].filter((v) => typeof v === "string" && v.trim().length > 0);

  if (candidates.length > 0) {
    return String(candidates[0]);
  }

  console.warn("Firecrawl fallback: no explicit html field found; returning empty string", {
    url,
    keys: Object.keys(data || {}),
  });
  return "";
}

export async function fetchHtml(url: string, userAgent: string): Promise<string> {
  const origin = (() => {
    try { return new URL(url).origin + "/"; } catch { return undefined; }
  })();

  const uaPool = [
    userAgent,
    // Alternate UA strings for retries (rotate to reduce naive blocking)
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ];

  const headersBase: Record<string, string> = {
    "user-agent": userAgent || "Mozilla/5.0",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-GB,en;q=0.9",
    "upgrade-insecure-requests": "1",
    ...(origin ? { "referer": origin } : {}),
  };

  let lastErr: any = null;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ua = uaPool[attempt % uaPool.length] || headersBase["user-agent"];
    const headers = { ...headersBase, "user-agent": ua };
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        lastStatus = res.status;
        lastErr = new Error(`HTTP ${res.status} fetching ${url}`);
        console.error("fetchHtml failed", { url, status: res.status, attempt: attempt + 1 });
        // If clearly blocked and Firecrawl available, try immediately
        if ((res.status === 403 || res.status === 429) && Deno.env.get("FIRECRAWL_API_KEY")) {
          try {
            return await fetchViaFirecrawl(url);
          } catch (fcErr) {
            console.error("Firecrawl fallback failed", { url, error: (fcErr as Error)?.message });
          }
        }
      } else {
        return await res.text();
      }
    } catch (e) {
      lastErr = e;
      console.error("fetchHtml error", { url, attempt: attempt + 1, error: (e as Error)?.message });
    }
    // Exponential backoff: 500ms, 1500ms, 4500ms
    await sleep(500 * Math.pow(3, attempt));
  }

  // After retries, if blocked or failed and Firecrawl is configured, try once
  if ((lastStatus === 403 || lastStatus === 429 || lastErr) && Deno.env.get("FIRECRAWL_API_KEY")) {
    try {
      return await fetchViaFirecrawl(url);
    } catch (fcErr) {
      console.error("Firecrawl fallback (post-retries) failed", { url, error: (fcErr as Error)?.message });
    }
  }

  throw lastErr ?? new Error(`Failed to fetch ${url}`);
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

// Map venue slugs to cinema names in DB
const CINEMA_SLUG_TO_NAME: Record<string, string> = {
  "ica": "ICA",
  "bfi-southbank": "BFI Southbank",
};

const cinemaIdCache = new Map<string, string>();

async function resolveCinemaId(supabase: SupabaseClient, slug: string): Promise<string> {
  if (cinemaIdCache.has(slug)) return cinemaIdCache.get(slug)!;
  const name = CINEMA_SLUG_TO_NAME[slug] ?? slug;
  const { data, error } = await supabase
    .from("cinemas")
    .select("id, name")
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Cinema not found for slug '${slug}' (expected name '${name}')`);
  cinemaIdCache.set(slug, data.id as string);
  return data.id as string;
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
      const cinemaUuid = await resolveCinemaId(supabase, row.venue_id);

      // Let Postgres generate the UUID id and upsert by natural key
      const payload = {
        cinema_id: cinemaUuid,
        film_id: filmId,
        start_time: row.start_at,
        end_time: null as string | null,
        screen: null as string | null,
        booking_url: row.booking_url || null,
        source_url: row.source_url || null,
      };

      const { error: upsertErr } = await supabase
        .from("screenings")
        .upsert(payload, { onConflict: "cinema_id,film_id,start_time" });

      if (upsertErr) throw upsertErr;
      successCount++;
    } catch (e: any) {
      console.warn("upsertScreenings row failed", { id: row.id, venue: row.venue_id, error: e?.message ?? String(e) });
      errors.push({ id: row.id, error: e?.message ?? String(e) });
    }
  }

  return { inserted: successCount, errors };
}

// Note: When you need HTML parsing, import cheerio at call sites:
// import { load } from "npm:cheerio@1.0.0-rc.12";
