import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertCircle, Upload, ArrowLeft } from "lucide-react";

type ImportData = {
  cinema: {
    name: string;
    location: string;
    website: string;
  };
  extraction_date: string;
  month_year: string;
  films: Array<{
    title: string;
    director: string;
    cast: string[];
    genre: string[];
    rating: string;
    duration: string;
    synopsis: string;
    showtimes: Array<{
      date: string;
      times: string[];
      screen: string;
      booking_url: string;
      special_screening: string | null;
    }>;
    letterboxd_url: string;
    poster_url: string | null;
  }>;
};

const DataImport = () => {
  const [jsonInput, setJsonInput] = useState("");
  const [parsedData, setParsedData] = useState<ImportData | null>(null);
  const [isValidJson, setIsValidJson] = useState(false);
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const validateAndParseJson = (input: string) => {
    try {
      const data = JSON.parse(input);
      
      // Basic validation
      if (!data.cinema || !data.films || !Array.isArray(data.films)) {
        throw new Error("Invalid JSON format. Missing required fields: cinema, films");
      }
      
      if (!data.cinema.name || !data.films.length) {
        throw new Error("Cinema name and at least one film are required");
      }

      setParsedData(data);
      setIsValidJson(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON format");
      setIsValidJson(false);
      setParsedData(null);
    }
  };

  const handleJsonChange = (value: string) => {
    setJsonInput(value);
    if (value.trim()) {
      validateAndParseJson(value);
    } else {
      setParsedData(null);
      setIsValidJson(false);
      setError("");
    }
  };

  const importData = async () => {
    if (!parsedData) return;

    setIsImporting(true);
    try {
      // 1. Insert or get cinema
      const { data: existingCinema, error: cinemaFetchError } = await supabase
        .from("cinemas")
        .select("id")
        .eq("name", parsedData.cinema.name)
        .single();

      let cinemaId: string;
      
      if (existingCinema) {
        cinemaId = existingCinema.id;
      } else {
        const { data: newCinema, error: cinemaInsertError } = await supabase
          .from("cinemas")
          .insert({ name: parsedData.cinema.name })
          .select("id")
          .single();
        
        if (cinemaInsertError) throw cinemaInsertError;
        cinemaId = newCinema.id;
      }

      // 2. Process each film
      let totalScreenings = 0;
      
      for (const film of parsedData.films) {
        // Insert or get film
        const { data: existingFilm, error: filmFetchError } = await supabase
          .from("films")
          .select("id")
          .eq("title", film.title)
          .single();

        let filmId: string;
        
        if (existingFilm) {
          filmId = existingFilm.id;
        } else {
          const { data: newFilm, error: filmInsertError } = await supabase
            .from("films")
            .insert({
              title: film.title,
              description: film.synopsis,
              runtime_mins: parseInt(film.duration) || null,
            })
            .select("id")
            .single();
          
          if (filmInsertError) throw filmInsertError;
          filmId = newFilm.id;
        }

        // 3. Insert screenings
        for (const showtime of film.showtimes) {
          for (const time of showtime.times) {
            const startTime = new Date(`${showtime.date}T${time}:00`).toISOString();
            
            const { error: screeningError } = await supabase
              .from("screenings")
              .insert({
                film_id: filmId,
                cinema_id: cinemaId,
                start_time: startTime,
                screen: showtime.screen,
                booking_url: showtime.booking_url,
              });
            
            if (screeningError) throw screeningError;
            totalScreenings++;
          }
        }
      }

      toast({
        title: "Import successful",
        description: `Imported ${parsedData.films.length} films with ${totalScreenings} screenings for ${parsedData.cinema.name}`,
      });

      // Clear form
      setJsonInput("");
      setParsedData(null);
      setIsValidJson(false);
      
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "An error occurred during import",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container py-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigate("/")}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Listings
            </Button>
            <h1 className="text-3xl tracking-tight font-semibold">
              Import Cinema Data
            </h1>
          </div>
        </div>
      </header>

      <main className="container py-10 max-w-4xl">
        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                JSON Data Import
              </CardTitle>
              <CardDescription>
                Paste your cinema listings JSON data below. The data will be validated and imported into the database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Paste your JSON data here..."
                value={jsonInput}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="min-h-[300px] font-mono text-sm"
              />
              
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {isValidJson && parsedData && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    JSON is valid and ready to import
                  </AlertDescription>
                </Alert>
              )}

              <Button 
                onClick={importData} 
                disabled={!isValidJson || isImporting}
                className="w-full"
              >
                {isImporting ? "Importing..." : "Import Data"}
              </Button>
            </CardContent>
          </Card>

          {parsedData && (
            <Card>
              <CardHeader>
                <CardTitle>Import Preview</CardTitle>
                <CardDescription>
                  Review the data that will be imported
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Cinema</h3>
                  <div className="space-y-1">
                    <p><strong>Name:</strong> {parsedData.cinema.name}</p>
                    <p><strong>Location:</strong> {parsedData.cinema.location}</p>
                    <p><strong>Website:</strong> {parsedData.cinema.website}</p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-2">
                    Films ({parsedData.films.length})
                  </h3>
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {parsedData.films.map((film, index) => (
                      <div key={index} className="border rounded p-4 space-y-2">
                        <h4 className="font-medium">{film.title}</h4>
                        <p className="text-sm text-muted-foreground">
                          {film.director} • {film.duration} mins
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {film.genre.map((g) => (
                            <Badge key={g} variant="secondary" className="text-xs">
                              {g}
                            </Badge>
                          ))}
                        </div>
                        <p className="text-sm">
                          <strong>Showtimes:</strong> {film.showtimes.reduce((acc, st) => acc + st.times.length, 0)} screenings
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default DataImport;