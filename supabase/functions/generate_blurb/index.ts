import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filmId, title, year } = await req.json();

    if (!title) {
      return new Response(JSON.stringify({ error: "Missing 'title' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Write a concise 2-3 sentence blurb (max ~60 words) for the film "${title}"${year ? ` (${year})` : ""}. Use UK English and a tone suitable for a repertory cinema listing. Avoid spoilers.`;

    const aiRes = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write succinct UK-English blurbs for repertory cinema listings." },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("OpenAI error:", aiRes.status, text);
      return new Response(JSON.stringify({ error: "OpenAI API error", details: text }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const description: string = aiJson?.choices?.[0]?.message?.content?.trim();

    if (!description) {
      return new Response(JSON.stringify({ error: "No description generated" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to persist to DB if filmId is provided
    let saved = false;
    try {
      if (filmId) {
        const url = Deno.env.get("SUPABASE_URL");
        const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (!url || !serviceRole) throw new Error("Missing Supabase service credentials");
        const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });
        const { error: updateErr } = await supabase.from("films").update({ description }).eq("id", filmId);
        if (updateErr) throw updateErr;
        saved = true;
      }
    } catch (dbErr) {
      console.warn("Failed to save description:", dbErr);
    }

    return new Response(JSON.stringify({ description, saved }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("generate_blurb error:", error);
    return new Response(JSON.stringify({ error: error?.message ?? "Unexpected error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
