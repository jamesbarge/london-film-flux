// Template wrapper to keep individual venue scrapers tiny
// Provides: env validation, polite UA, CORS, JSON responses, and Deno.serve

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type ScrapeResult = { scraped: number; inserted: number };
export type ScrapeContext = {
  supabase: SupabaseClient;
  userAgent: string;
  req: Request;
  payload: any;
};

function buildUserAgent() {
  const contact = Deno.env.get("SCRAPER_CONTACT_EMAIL")?.trim() || "listings@example.com";
  return `LondonRepertoryBot/1.0 (+contact: ${contact})`;
}

export function createScraper(
  scrapeFn: (ctx: ScrapeContext) => Promise<ScrapeResult>
) {
  const userAgent = buildUserAgent();

  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error("Missing required Supabase env vars");
        return new Response(
          JSON.stringify({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      });

      let payload: any = {};
      if (req.method !== "GET") {
        try {
          payload = await req.json();
        } catch {
          payload = {};
        }
      }

      const result = await scrapeFn({ supabase, userAgent, req, payload });

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("Scraper error:", err);
      return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  });
}
