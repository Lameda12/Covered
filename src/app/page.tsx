import { Deck } from "@/components/Deck";
import type { PublicBill } from "@/components/BillCard";
import { dollars } from "@/lib/money";
import { withDb } from "@/lib/db";

export const revalidate = 10; // static + refreshed every 10s; the webhook also revalidates on each payment

async function load() {
  try {
    return await withDb(async (sql) => {
      const bills = await sql<PublicBill[]>`select id,category,biller_name,account_last4,amount_cents,funded_cents,due_date,city,first_name,note from public_bills order by due_date, created_at limit 60`;
      const [stats] = await sql<{ week_cents: number; week_bills: number }[]>`select week_cents::int, week_bills from public_stats`;
      return { bills, stats };
    });
  } catch {
    return { bills: [] as PublicBill[], stats: null };
  }
}

export default async function Home() {
  const { bills, stats } = await load();
  return (
    <>
      <p className="tally mono" style={{ textAlign: "left", margin: "0 0 10px" }}>
        Covered this week <b>{dollars(stats?.week_cents ?? 0, 0)}</b> · <b>{stats?.week_bills ?? 0}</b> bills
      </p>
      <h1>Pay a stranger&apos;s bill. Straight to the biller.</h1>
      <p className="sub">Every bill is read, matched to its biller and reviewed by our team. Your money never touches their account, so it can&apos;t be spent on anything else.</p>
      <Deck bills={bills} />
    </>
  );
}
