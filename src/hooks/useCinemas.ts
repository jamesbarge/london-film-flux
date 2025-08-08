import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Cinema = {
  id: string;
  name: string;
};

export function useCinemas() {
  return useQuery<Cinema[]>({
    queryKey: ["cinemas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cinemas")
        .select("id,name")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 1000 * 60 * 5,
  });
}
