import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import FilterBar from "@/components/FilterBar";
import DayView from "@/components/DayView";
import MonthView from "@/components/MonthView";
const Index = () => {
  const [selectedCinemas, setSelectedCinemas] = useState<string[]>([]);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [view, setView] = useState<"day" | "month">("day");

  useEffect(() => {
    const run = async () => {
      const { data, error } = await supabase.rpc("get_server_time");
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
          <FilterBar onChange={(v) => { setSelectedCinemas(v.cinemas); setDate(v.date); setView(v.view); }} />
        </div>
        {view === "day" ? (
          <DayView date={date} cinemaIds={selectedCinemas} />
        ) : (
          <MonthView
            date={date}
            cinemaIds={selectedCinemas}
            onSelectDay={(d) => { setDate(d); setView("day"); }}
          />
        )}
      </main>
    </div>;
};
export default Index;