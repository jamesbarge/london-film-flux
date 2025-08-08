import { useEffect, useState } from "react";
import FilterBar from "@/components/FilterBar";
import DayView from "@/components/DayView";
import MonthView from "@/components/MonthView";

// Local type to avoid coupling to FilterBar's internal types
type LocalFilterValue = {
  cinemas: string[];
  date?: Date;
  view: "day" | "month";
};

const ListingsPage = () => {
  const [selectedCinemas, setSelectedCinemas] = useState<string[]>([]);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [view, setView] = useState<"day" | "month">("day");

  // Basic SEO: set a descriptive title
  useEffect(() => {
    document.title = "London Repertory Cinema Listings";
  }, []);

  return (
    <section aria-label="Listings" className="space-y-6">
      <div className="mb-6">
        <FilterBar
          onChange={(v: LocalFilterValue) => {
            setSelectedCinemas(v.cinemas);
            setDate(v.date);
            setView(v.view);
          }}
        />
      </div>
      {view === "day" ? (
        <DayView date={date} cinemaIds={selectedCinemas} />
      ) : (
        <MonthView
          date={date}
          cinemaIds={selectedCinemas}
          onSelectDay={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      )}
    </section>
  );
};

export default ListingsPage;
