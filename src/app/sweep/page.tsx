import { SweepBuilder } from "@/components/SweepBuilder";
import { supabaseAnon } from "@/lib/supabase/admin";

export const revalidate = 30;
export const metadata = { title: "Sweep · Covered" };

export default async function Sweep() {
  let cities: string[] = [];
  try {
    const { data } = await supabaseAnon().from("public_bills").select("city").limit(2000);
    cities = [...new Set((data ?? []).map((d) => d.city as string))].sort();
  } catch {}
  return (
    <>
      <h1>One sentence. Hundreds of bills.</h1>
      <p className="sub">Describe what you want covered. Covered pays every verified bill that fits, most urgent first, until your budget runs out.</p>
      <SweepBuilder cities={cities} />
    </>
  );
}
