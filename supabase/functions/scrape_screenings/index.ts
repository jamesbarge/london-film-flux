import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Types
interface ScrapeResult {
  inserted: number;
  skipped: number;
  createdFilms: number;
  createdCinemas: number;
  totalFound: number;
  details: Array<{ title: string; start: string; status: "inserted" | "skipped" | "error"; error?: string }>; 
}

interface EventItem { title: string; start: string; end?: string }

// Supabase client with service role (bypasses RLS for server-only operations)
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}
const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

// Utilities
function parseJsonSafe<T = unknown>(input: string): T | null {
  try {
    return JSON.parse(input) as T;
  } catch (_e) {
    return null;
  }
}

function extractJsonLdObjects(html: string): any[] {
  const results: any[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    // Some sites wrap multiple JSON objects or have invalid commas; try common fixes
    const candidates = [raw, raw.replace(/\u0000/g, "").replace(/\,\s*\]/g, "]").replace(/\,\s*\}/g, "}")];
    for (const c of candidates) {
      const parsed = parseJsonSafe<any>(c);
      if (parsed) {
        if (Array.isArray(parsed)) results.push(...parsed);
        else results.push(parsed);
        break;
      }
    }
  }
  return results;
}

function flatten<T = any>(x: any): T[] {
  if (Array.isArray(x)) return x.flatMap((i) => flatten<T>(i));
  if (x && typeof x === "object") {
    const vals: T[] = [];
    for (const k of Object.keys(x)) {
      vals.push(...flatten<T>((x as any)[k]));
    }
    return vals;
  }
  return [] as T[];
}

function extractEventsFromJsonLd(html: string): EventItem[] {
  const jsons = extractJsonLdObjects(html);
  const allNodes = [
    ...jsons,
    ...jsons.flatMap((j) => (j && typeof j === "object" ? Object.values(j) : [])),
  ];
  const flattened = flatten<any>(allNodes).concat(jsons);
  const events: EventItem[] = [];

  for (const node of flattened) {
    if (!node || typeof node !== "object") continue;
    const type = (node["@type"] || node["type"]) as string | string[] | undefined;
    const types = Array.isArray(type) ? type : type ? [type] : [];
    const isEvent = types.some((t) => /Event$/i.test(String(t)) || /^Event$/i.test(String(t)));

    // schema.org patterns
    const start = node["startDate"] || node["startTime"];
    const end = node["endDate"] || node["endTime"];
    const name = node["name"] || node["workPresented"]?.["name"] || node["workPresented"]?.["@name"]; 

    if (isEvent && start && name) {
      try {
        const startIso = new Date(start).toISOString();
        const endIso = end ? new Date(end).toISOString() : undefined;
        events.push({ title: String(name).trim(), start: startIso, end: endIso });
      } catch (_e) {
        // ignore invalid dates
      }
    }

    // Some sites nest events under 'event' or 'events'
    if (Array.isArray((node as any).event)) {
      for (const e of (node as any).event) {
        const s = e?.startDate || e?.startTime;
        const nm = e?.name || e?.workPresented?.name;
        if (s && nm) {
          try {
            events.push({ title: String(nm).trim(), start: new Date(s).toISOString() });
          } catch {}
        }
      }
    }
  }

  // Deduplicate by (title + start)
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = `${e.title}|${e.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchIcaEvents(): Promise<EventItem[]> {
  const urls = [
    "https://www.ica.art/films",
    "https://www.ica.art/next-7-days",
    "https://www.ica.art/today",
    "https://www.ica.art/tomorrow",
  ];
  const responses = await Promise.allSettled(urls.map((u) => fetch(u)));
  const htmls: string[] = [];
  for (const r of responses) {
    if (r.status === "fulfilled" && r.value.ok) {
      htmls.push(await r.value.text());
    }
  }
  const events = htmls.flatMap((h) => extractEventsFromJsonLd(h));
  // Best-effort: filter out non-film events if title suggests otherwise
  return events.filter((e) => e.title && e.title.length > 1);
}

async function ensureCinema(name: string): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("cinemas")
    .select("id,name")
    .ilike("name", name)
    .maybeSingle();
  if (selErr) console.warn("select cinema error", selErr.message);
  if (existing?.id) return existing.id;

  const { data: created, error: insErr } = await supabase
    .from("cinemas")
    .insert({ name })
    .select("id")
    .single();
  if (insErr) throw new Error(`Failed to create cinema '${name}': ${insErr.message}`);
  return created!.id as string;
}

async function ensureFilm(title: string): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: selErr } = await supabase
    .from("films")
    .select("id,title")
    .eq("title", title)
    .maybeSingle();
  if (selErr) console.warn("select film error", selErr.message);
  if (existing?.id) return { id: existing.id, created: false };

  const { data: created, error: insErr } = await supabase
    .from("films")
    .insert({ title })
    .select("id")
    .single();
  if (insErr) throw new Error(`Failed to create film '${title}': ${insErr.message}`);
  return { id: created!.id as string, created: true };
}

async function screeningExists(cinemaId: string, filmId: string, startIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("screenings")
    .select("id")
    .eq("cinema_id", cinemaId)
    .eq("film_id", filmId)
    .eq("start_time", startIso)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    // PGRST116: No rows found for maybeSingle
    console.warn("exists check error", error.message);
  }
  return !!data?.id;
}

async function insertScreening(cinemaId: string, filmId: string, startIso: string, endIso?: string) {
  const { error } = await supabase
    .from("screenings")
    .insert({ cinema_id: cinemaId, film_id: filmId, start_time: startIso, end_time: endIso ?? null });
  if (error) throw new Error(`Insert screening failed: ${error.message}`);
}

async function scrapeICA(): Promise<ScrapeResult> {
  let createdFilms = 0;
  let createdCinemas = 0;
  let inserted = 0;
  let skipped = 0;
  const details: ScrapeResult["details"] = [];

  // Ensure cinema
  let cinemaId: string;
  try {
    cinemaId = await ensureCinema("ICA");
  } catch (e) {
    createdCinemas++;
    throw e;
  }

  const events = await fetchIcaEvents();

  for (const ev of events) {
    try {
      const { id: filmId, created } = await ensureFilm(ev.title);
      if (created) createdFilms++;

      const exists = await screeningExists(cinemaId, filmId, ev.start);
      if (exists) {
        skipped++;
        details.push({ title: ev.title, start: ev.start, status: "skipped" });
        continue;
      }

      await insertScreening(cinemaId, filmId, ev.start, ev.end);
      inserted++;
      details.push({ title: ev.title, start: ev.start, status: "inserted" });
    } catch (error: any) {
      skipped++;
      details.push({ title: ev.title, start: ev.start, status: "error", error: String(error?.message || error) });
    }
  }

  return { inserted, skipped, createdFilms, createdCinemas, totalFound: events.length, details };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source } = await (async () => {
      try { return await req.json(); } catch { return { source: "ica" }; }
    })();

    let result: ScrapeResult | null = null;

    switch ((source || "ica").toLowerCase()) {
      case "ica":
        result = await scrapeICA();
        break;
      // Placeholders for future cinemas
      case "bfi":
      case "barbican":
      case "rio":
      case "prince-charles":
      default:
        return new Response(
          JSON.stringify({ ok: false, error: `Scraper for '${source}' not implemented yet` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify({ ok: true, cinema: source || "ica", ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scrape_screenings error", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
