import { SweepBuilder } from "@/components/SweepBuilder";
import { withDb } from "@/lib/db";

export const revalidate = 30;
export const metadata = { title: "Sweep · Covered" };

export default async function Sweep() {
  let cities: string[] = [];
  try {
    cities = (await withDb((sql) => sql<{ city: string }[]>`select distinct city from public_bills order by city limit 200`)).map((r) => r.city);
  } catch {}
  return (
    <>
      <h1>One sentence. Hundreds of bills.</h1>
      <p className="sub">Describe what you want covered. Covered pays every verified bill that fits, most urgent first, until your budget runs out.</p>
      <SweepBuilder cities={cities} />
    </>
  );
}
