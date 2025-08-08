import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { startOfMonth, endOfMonth } from "date-fns";
import { Loader2 } from "lucide-react";
interface MonthViewProps {
  date?: Date;
  cinemaIds: string[];
  onSelectDay: (date: Date) => void;
}

const MonthView: React.FC<MonthViewProps> = ({ date, cinemaIds, onSelectDay }) => {
  const initial = date ? new Date(date) : new Date();
  const [month, setMonth] = React.useState<Date>(startOfMonth(initial));

  const from = startOfMonth(month).toISOString();
  const to = endOfMonth(month).toISOString();

  const { data: highlightedDays = [], isLoading, isError } = useQuery<Date[]>({
    queryKey: [
      "month-screening-days",
      month.toISOString(),
      (cinemaIds && cinemaIds.length > 0 ? [...cinemaIds].sort().join(",") : "all"),
    ],
    queryFn: async () => {
      const query = (supabase as any)
        .from("screenings")
        .select("id,start_time,cinema_id")
        .gte("start_time", from)
        .lt("start_time", to);

      const finalQuery = cinemaIds && cinemaIds.length > 0
        ? query.in("cinema_id", cinemaIds)
        : query;

      const { data, error } = await finalQuery;
      if (error) throw error;

      // Build unique local dates that have screenings
      const map = new Map<string, Date>();
      (data ?? []).forEach((row: any) => {
        const dt = new Date(row.start_time);
        const localDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
        const key = `${localDay.getFullYear()}-${localDay.getMonth()}-${localDay.getDate()}`;
        if (!map.has(key)) map.set(key, localDay);
      });
      return Array.from(map.values());
    },
    staleTime: 1000 * 60 * 5,
  });

  return (
    <section aria-label="Month schedule" className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">Calendar</h3>
        {isLoading && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Loading…
          </span>
        )}
        {isError && <span className="text-xs text-destructive">Failed to load highlights</span>}
      </div>
      {!isLoading && !isError && highlightedDays.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">No screenings found this month for the selected cinemas.</p>
      )}
      <Calendar
        mode="single"
        selected={date}
        onSelect={(d) => d && onSelectDay(d)}
        month={month}
        onMonthChange={(m) => m && setMonth(startOfMonth(m))}
        className={cn("p-3 pointer-events-auto")}
        modifiers={{ hasScreenings: highlightedDays }}
        modifiersClassNames={{
          hasScreenings:
            "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1.5 after:h-1.5 after:rounded-full after:bg-primary",
        }}
        showOutsideDays
      />
    </section>
  );
};

export default MonthView;
