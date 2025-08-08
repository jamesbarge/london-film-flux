import * as React from "react";
import { format } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Calendar as CalendarIcon } from "lucide-react";
import { useCinemas } from "@/hooks/useCinemas";

export type FilterValue = {
  cinemas: string[];
  date: Date | undefined;
  view: "day" | "month";
};

interface FilterBarProps {
  onChange?: (value: FilterValue) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({ onChange }) => {
  const { data: cinemas = [], isLoading, isError } = useCinemas();

  const [selectedCinemas, setSelectedCinemas] = React.useState<string[]>([]);
  const [date, setDate] = React.useState<Date | undefined>(new Date());
  const [view, setView] = React.useState<"day" | "month">("day");

  React.useEffect(() => {
    onChange?.({ cinemas: selectedCinemas, date, view });
  }, [selectedCinemas, date, view, onChange]);

  const toggleCinema = (id: string, checked: boolean | string) => {
    setSelectedCinemas((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((c) => c !== id)
    );
  };

  const selectedCount = selectedCinemas.length;

  return (
    <section aria-label="Filters" className="w-full">
      <div className="flex flex-wrap items-center gap-3">
        {/* Cinemas multi-select */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="min-w-[180px] justify-start">
              {selectedCount > 0 ? `${selectedCount} cinema${selectedCount > 1 ? "s" : ""} selected` : "All cinemas"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="p-3 border-b">
              <p className="text-sm font-medium">Select cinemas</p>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {isLoading && (
                <p className="px-2 py-3 text-sm text-muted-foreground">Loading cinemas…</p>
              )}
              {isError && (
                <p className="px-2 py-3 text-sm text-destructive">Failed to load cinemas.</p>
              )}
              {!isLoading && !isError && cinemas.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted-foreground">No cinemas found.</p>
              )}
              {!isLoading && !isError && cinemas.length > 0 && (
                <ul className="space-y-2">
                  {cinemas.map((c) => {
                    const checked = selectedCinemas.includes(c.id);
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-2">
                        <Checkbox
                          id={`cin-${c.id}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleCinema(c.id, v)}
                        />
                        <label htmlFor={`cin-${c.id}`} className="text-sm">
                          {c.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Date picker */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn("min-w-[200px] justify-start text-left font-normal")}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "PPP") : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={date}
              onSelect={setDate}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {/* View toggle */}
        <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "day" | "month")}
          className="">
          <ToggleGroupItem value="day" className="">Day</ToggleGroupItem>
          <ToggleGroupItem value="month" className="">Month</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </section>
  );
};

export default FilterBar;
