import React from "react";
import { format } from "date-fns";
import { Loader2, Film, Wand2 } from "lucide-react";
import { useScreenings } from "@/hooks/useScreenings";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface DayViewProps {
  date?: Date;
  cinemaIds: string[];
}

const DayView: React.FC<DayViewProps> = ({ date, cinemaIds }) => {
  const { data = [], isLoading, isError, refetch } = useScreenings(date, cinemaIds);
  const { toast } = useToast();
  const [generating, setGenerating] = React.useState<Record<string, boolean>>({});

  const handleGenerate = async (s: { filmId: string; filmTitle: string }) => {
    try {
      setGenerating((g) => ({ ...g, [s.filmId]: true }));
      const { data, error } = await supabase.functions.invoke("generate_blurb", {
        body: { filmId: s.filmId, title: s.filmTitle },
      });
      if (error) throw error;
      toast({ title: "Blurb generated", description: `Added a short blurb for ${s.filmTitle}.` });
      await refetch();
    } catch (e: any) {
      console.error("generate_blurb failed", e);
      toast({ title: "Failed to generate blurb", description: e?.message ?? "Please try again." });
    } finally {
      setGenerating((g) => ({ ...g, [s.filmId]: false }));
    }
  };

  if (!date) {
    return (
      <section aria-label="Day schedule" className="rounded-lg border border-border bg-card/50 p-4">
        <p className="text-muted-foreground text-sm">Please pick a date to see screenings.</p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section aria-label="Day schedule" className="rounded-lg border border-border bg-card/50 p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Loading screenings…</span>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section aria-label="Day schedule" className="rounded-lg border border-border bg-card/50 p-4">
        <p className="text-destructive text-sm">Failed to load screenings.</p>
      </section>
    );
  }

  if (!data || data.length === 0) {
    return (
      <section aria-label="Day schedule" className="rounded-lg border border-border bg-card/50 p-4">
        <div className="flex items-center gap-3">
          <Film className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium">No screenings on {format(date!, "EEE d MMM")}</p>
            <p className="text-xs text-muted-foreground">Try a different date or adjust your cinema filters.</p>
          </div>
        </div>
      </section>
    );
  }

  const shouldGroup = cinemaIds.length > 1;

  if (shouldGroup) {
    const groups = data.reduce((acc: Record<string, typeof data>, item) => {
      acc[item.cinemaName] = acc[item.cinemaName] || [];
      acc[item.cinemaName].push(item);
      return acc;
    }, {} as Record<string, typeof data>);

    const cinemaNames = Object.keys(groups).sort();

    return (
      <section aria-label="Day schedule" className="space-y-6">
        {cinemaNames.map((name) => (
          <article key={name} className="rounded-lg border border-border bg-card/50">
            <header className="px-4 py-3 border-b">
              <h3 className="text-base font-semibold">{name}</h3>
            </header>
            <ul className="divide-y">
              {groups[name].map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <time className="font-mono text-sm text-muted-foreground w-16">
                    {format(new Date(s.timeISO), "HH:mm")}
                  </time>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{s.filmTitle}</p>
                    {s.filmDescription ? (
                      <p className="text-xs text-muted-foreground">
                        {s.filmDescription.length > 200 ? s.filmDescription.slice(0, 200) + "…" : s.filmDescription}
                      </p>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleGenerate({ filmId: (s as any).filmId, filmTitle: s.filmTitle })}
                        disabled={!!(generating as any)[(s as any).filmId]}
                        aria-label={`Generate blurb for ${s.filmTitle}`}
                      >
                        {(generating as any)[(s as any).filmId] ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Wand2 className="h-4 w-4" />
                        )}
                        Generate blurb
                      </Button>
                    )}
                  </div>
                  <div className="shrink-0">
                    {(s as any).bookingUrl ? (
                      <Button asChild size="sm" variant="secondary" aria-label={`Book ${s.filmTitle}`}>
                        <a href={(s as any).bookingUrl} target="_blank" rel="noopener noreferrer">
                          Book
                        </a>
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled aria-disabled="true" title="Booking link not available yet">
                        Book
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    );
  }

  // Ungrouped single list
  return (
    <section aria-label="Day schedule" className="rounded-lg border border-border bg-card/50">
      <ul className="divide-y">
        {data.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3">
            <time className="font-mono text-sm text-muted-foreground w-16">
              {format(new Date(s.timeISO), "HH:mm")}
            </time>
            <div className="flex-1">
              <p className="text-sm font-medium">{s.filmTitle}</p>
              <p className="text-xs text-muted-foreground">{s.cinemaName}</p>
              {s.filmDescription ? (
                <p className="text-xs text-muted-foreground">
                  {s.filmDescription.length > 200 ? s.filmDescription.slice(0, 200) + "…" : s.filmDescription}
                </p>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleGenerate({ filmId: (s as any).filmId, filmTitle: s.filmTitle })}
                  disabled={!!(generating as any)[(s as any).filmId]}
                  aria-label={`Generate blurb for ${s.filmTitle}`}
                >
                  {(generating as any)[(s as any).filmId] ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Generate blurb
                </Button>
              )}
            </div>
            <div className="shrink-0">
              {(s as any).bookingUrl ? (
                <Button asChild size="sm" variant="secondary" aria-label={`Book ${s.filmTitle}`}>
                  <a href={(s as any).bookingUrl} target="_blank" rel="noopener noreferrer">
                    Book
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled aria-disabled="true" title="Booking link not available yet">
                  Book
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default DayView;
