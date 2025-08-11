import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOfDay, endOfDay } from "date-fns";

export type ScreeningItem = {
  id: string;
  timeISO: string;
  filmTitle: string;
  filmId: string;
  filmDescription?: string | null;
  cinemaName: string;
  cinemaId: string;
  bookingUrl?: string | null;
};

export function useScreenings(date: Date | undefined, cinemaIds: string[]) {
  const from = date ? startOfDay(date).toISOString() : undefined;
  const to = date ? endOfDay(date).toISOString() : undefined;

  return useQuery<ScreeningItem[]>({
    queryKey: [
      "screenings",
      date ? date.toDateString() : "no-date",
      [...cinemaIds].sort().join(",") || "all",
    ],
    enabled: !!date,
    queryFn: async () => {
      const query = (supabase as any)
        .from("screenings")
        .select("id,start_time,cinema_id,booking_url,film_id,film:films(id,title,description),cinema:cinemas(id,name)")
        .gte("start_time", from!)
        .lt("start_time", to!)
        .order("start_time", { ascending: true });

      const finalQuery = cinemaIds && cinemaIds.length > 0
        ? query.in("cinema_id", cinemaIds)
        : query;

      const { data, error } = await finalQuery;
      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        timeISO: row.start_time,
        filmTitle: row.film?.title ?? "Untitled",
        filmId: row.film?.id ?? row.film_id,
        filmDescription: row.film?.description ?? null,
        cinemaName: row.cinema?.name ?? "Unknown cinema",
        cinemaId: row.cinema_id,
        bookingUrl: row.booking_url ?? null,
      }));
    },
    staleTime: 1000 * 60, // 1 min
  });
}
