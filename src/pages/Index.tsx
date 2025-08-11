import { useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ListingsPage from "@/components/ListingsPage";
const Index = () => {
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
        <div className="container py-8 flex items-center justify-between gap-4">
          <h1 className="text-3xl tracking-tight title-sheen text-left md:text-3xl font-semibold">
            London Repertory Cinema Listings
          </h1>
          <nav>
            <Link to="/functions" className="text-sm underline underline-offset-4 hover:opacity-80">
              Run Functions
            </Link>
          </nav>
        </div>
      </header>

      <main className="container py-10">
        <ListingsPage />
      </main>
    </div>;
};
export default Index;