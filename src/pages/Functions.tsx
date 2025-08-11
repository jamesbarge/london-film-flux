import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";

type FnName = "scrape_ica" | "scrape_bfi" | "scrape_all" | "scrape_screenings";

type FnItem = { id: FnName; label: string; description: string };

const FUNCTIONS: FnItem[] = [
  { id: "scrape_ica", label: "Scrape ICA", description: "Collects ICA screenings and upserts." },
  { id: "scrape_bfi", label: "Scrape BFI Southbank", description: "Collects BFI screenings and upserts." },
  { id: "scrape_all", label: "Scrape All", description: "Runs all collectors and upserts once." },
  { id: "scrape_screenings", label: "Scrape Screenings", description: "General screenings scrape." },
];

export default function FunctionsPage() {
  const { toast } = useToast();
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    document.title = "Run Supabase Edge Functions | Admin";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Run Supabase Edge Functions from the UI: scrape ICA, BFI, or all.");
  }, []);

  const sortedFunctions = useMemo(() => FUNCTIONS, []);

  const runFn = async (name: FnName) => {
    setRunning((s) => ({ ...s, [name]: true }));
    setErrors((s) => ({ ...s, [name]: "" }));
    try {
      const { data, error } = await supabase.functions.invoke(name, { body: {} });
      if (error) throw error;
      setResults((r) => ({ ...r, [name]: data }));
      toast({ title: `${name} completed`, description: "Check the result below.", duration: 2500 });
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErrors((er) => ({ ...er, [name]: msg }));
      toast({ title: `${name} failed`, description: msg, variant: "destructive", duration: 3500 });
    } finally {
      setRunning((s) => ({ ...s, [name]: false }));
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="container py-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl tracking-tight title-sheen text-left md:text-3xl font-semibold">
              Run Supabase Edge Functions
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Trigger your scraping functions directly from the browser. Results display inline; detailed logs are in the Supabase dashboard.
            </p>
          </div>
          <nav>
            <Link to="/" className="text-sm underline underline-offset-4 hover:opacity-80">
              Back to Home
            </Link>
          </nav>
        </div>
      </header>

      <main className="container py-10">
        <div className="grid gap-6 md:grid-cols-2">
          {sortedFunctions.map((fn) => (
            <Card key={fn.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle>{fn.label}</CardTitle>
                    <CardDescription>{fn.description}</CardDescription>
                  </div>
                  <Badge variant="secondary">{fn.id}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Button onClick={() => runFn(fn.id)} disabled={!!running[fn.id]}>
                    {running[fn.id] ? "Running…" : "Run"}
                  </Button>
                </div>

                <Separator className="my-4" />

                {errors[fn.id] && (
                  <div className="text-destructive text-sm mb-3" role="alert">
                    {errors[fn.id]}
                  </div>
                )}

                <div className="text-xs">
                  <pre className="whitespace-pre-wrap break-words">
                    {results[fn.id] ? JSON.stringify(results[fn.id], null, 2) : "No result yet."}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
