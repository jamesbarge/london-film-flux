import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import FilterBar from "@/components/FilterBar";
const Index = () => {
  useEffect(() => {
    const run = async () => {
      const {
        data,
        error
      } = await supabase.rpc("get_server_time");
      if (error) {
        console.error("Supabase connectivity check failed:", error);
      } else {
        console.log("Supabase connectivity check (server time):", data);
      }
    };
    run();
  }, []);
  return <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="container py-8">
          <h1 className="text-3xl tracking-tight title-sheen text-left md:text-3xl font-semibold">
            London Repertory Cinema Listings
          </h1>
        </div>
      </header>

      <main className="container py-10">
        <div className="mb-6">
          <FilterBar onChange={v => console.log("Filters changed:", v)} />
        </div>
        <section aria-labelledby="content-ready" className="rounded-lg border border-border bg-card/50 p-8">
          <h2 id="content-ready" className="sr-only">Main Content</h2>
          <p className="text-muted-foreground">
            This area is ready for components: filters, calendars, and cinema schedules.
          </p>
        </section>
      </main>
    </div>;
};
export default Index;