/**
 * pnpm seed: inserts 30 realistic live bills across the 8 prototype cities.
 * Refuses to run against production. Requires ALLOW_SEED=1 so it is never run by accident.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)");
if (process.env.ALLOW_SEED !== "1") throw new Error("Refusing to seed. Run `ALLOW_SEED=1 pnpm seed` against a NON-production database.");
if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
if (process.env.SEED_TARGET_IS_PRODUCTION === "1") throw new Error("Refusing to seed: SEED_TARGET_IS_PRODUCTION=1");

const sb = createClient(url, key, { auth: { persistSession: false } });

const CITIES = ["Detroit", "Halifax", "Memphis", "Fresno", "Cleveland", "Winnipeg", "Baltimore", "Tucson"];
const NAMES = ["Tanya", "Marcus", "Leah", "Dev", "Rosa", "Jamal", "Priya", "Owen", "Aisha", "Luis", "Grace", "Malik", "Nina", "Carlos", "Joy", "Theo", "Imani", "Sam", "Elena", "Kofi", "Mei", "Andre", "Dana", "Yusuf", "Hannah", "Ray", "Lina", "Victor", "Bea", "Omar"];
const CATS: Record<string, { billers: string[]; min: number; max: number }> = {
  rent: { billers: ["Lakeview Property Mgmt", "Harbor Homes", "Oakline Rentals"], min: 650, max: 1500 },
  electric: { billers: ["Metro Electric"], min: 60, max: 420 },
  heat: { billers: ["Northern Gas Co."], min: 80, max: 520 },
  water: { billers: ["City Water Dept."], min: 40, max: 230 },
  internet: { billers: ["FiberLink", "CityNet"], min: 45, max: 120 },
  phone: { billers: ["Wave Mobile"], min: 35, max: 140 },
  medical: { billers: ["St. Clair Clinic", "Mercy Health", "Riverside Pharmacy"], min: 90, max: 1500 },
  childcare: { billers: ["Little Steps Daycare", "Bright Start Center"], min: 300, max: 1200 },
  car: { billers: ["Keystone Auto Ins.", "Route Auto Loan"], min: 110, max: 480 },
};
const NOTES = ["Hours got cut at the warehouse in October.", "Between jobs, new one starts Dec 2.", "Single dad, two kids, one paycheck short this month.", "Back from surgery, first paycheck lands next week.", "Car broke down and the repair ate the rent money.", "Caring for my mom full time right now.", "Got the job. First check is three weeks out.", "Just need to not fall behind once."];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function main() {
  const catKeys = Object.keys(CATS);
  for (let i = 0; i < 30; i++) {
    const email = `seed-${Date.now()}-${i}@covered.test`;
    const { data: u, error: ue } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (ue || !u.user) throw ue;
    const cat = catKeys[i % catKeys.length];
    const c = CATS[cat];
    const amount = Math.round((c.min + Math.pow(Math.random(), 1.4) * (c.max - c.min)) * 100);
    const due = new Date(Date.now() + (1 + Math.floor(Math.pow(Math.random(), 1.6) * 28)) * 864e5).toISOString().slice(0, 10);
    const funded = Math.random() < 0.35 ? Math.round(amount * Math.random() * 0.7) : 0;
    const { error } = await sb.from("bills").insert({
      requester_id: u.user.id, status: "live", category: cat, biller_name: pick(c.billers), account_last4: String(1000 + Math.floor(Math.random() * 9000)),
      amount_cents: amount, funded_cents: funded, due_date: due, city: CITIES[i % CITIES.length], first_name: NAMES[i % NAMES.length],
      note: Math.random() < 0.6 ? pick(NOTES) : null,
    });
    if (error) throw error;
  }
  console.log("Seeded 30 live bills.");
}
main().catch((e) => { console.error(e); process.exit(1); });
