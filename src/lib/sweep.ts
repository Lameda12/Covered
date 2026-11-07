import type { SweepFilters } from "@/lib/validation";

export type PlanBill = {
  id: string; category: string; city: string; biller_name: string; due_date: string;
  amount_cents: number; funded_cents: number;
};

/** Pure mirror of the SQL `allocate_sweep` selection, used for the live preview. SQL stays authoritative. */
export function planSweep(bills: PlanBill[], f: SweepFilters, today = new Date()) {
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const cities = f.cities.map((c) => c.toLowerCase());
  const matching = bills
    .filter((b) => b.amount_cents > b.funded_cents)
    .filter((b) => !f.categories.length || f.categories.includes(b.category as never))
    .filter((b) => !cities.length || cities.includes(b.city.toLowerCase()))
    .filter((b) => f.max_bill_cents == null || b.amount_cents - b.funded_cents <= f.max_bill_cents)
    .filter((b) => f.due_within_days == null || new Date(b.due_date + "T00:00:00Z").getTime() <= todayMs + f.due_within_days * 864e5)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.amount_cents - a.funded_cents) - (b.amount_cents - b.funded_cents) || a.id.localeCompare(b.id));
  let left = f.budget_cents;
  const take: PlanBill[] = [];
  for (const b of matching) {
    const rem = b.amount_cents - b.funded_cents;
    if (rem <= left) { take.push(b); left -= rem; }
  }
  const byCategory: Record<string, number> = {};
  for (const b of take) byCategory[b.category] = (byCategory[b.category] ?? 0) + (b.amount_cents - b.funded_cents);
  return {
    matching: matching.length,
    owed: matching.reduce((s, b) => s + b.amount_cents - b.funded_cents, 0),
    take, spend: f.budget_cents - left, leftover: left, byCategory,
    households: take.length,
  };
}

const CAT_WORDS: Record<string, string> = {
  rent: "rent", electric: "electric", electricity: "electric", hydro: "electric", heat: "heat", heating: "heat", gas: "heat",
  water: "water", internet: "internet", wifi: "internet", phone: "phone", mobile: "phone", medical: "medical", health: "medical",
  childcare: "childcare", daycare: "childcare", car: "car", auto: "car",
};

/** Offline fallback when the Claude parser is unavailable. Handles the common phrasings. */
export function parseSweepHeuristic(text: string, knownCities: string[]): SweepFilters {
  const t = text.toLowerCase();
  const categories = [...new Set(Object.entries(CAT_WORDS).filter(([w]) => new RegExp(`\\b${w}\\b`).test(t)).map(([, c]) => c))] as SweepFilters["categories"];
  const cities = knownCities.filter((c) => t.includes(c.toLowerCase()));
  const money = (s: string) => {
    const m = s.match(/\$?\s*([\d,.]+)\s*(k|m)?\b/i);
    if (!m) return undefined;
    const n = parseFloat(m[1].replace(/,/g, ""));
    return Math.round(n * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1) * 100);
  };
  const under = t.match(/(?:under|below|up to|max(?:imum)?|less than)\s*(\$?\s*[\d,.]+\s*k?)/);
  const budgetM = t.match(/(\$\s*[\d,.]+\s*[km]?)\s*(?:budget|total)?\s*$/) ?? t.match(/budget(?: of)?\s*(\$?\s*[\d,.]+\s*[km]?)/) ?? t.match(/,\s*(\$\s*[\d,.]+\s*[km]?)\b/);
  let due: number | undefined;
  if (/this week|within (?:a )?week|7 days/.test(t)) due = 7;
  else if (/today|tomorrow|24 hours/.test(t)) due = 2;
  else if (/this month|30 days/.test(t)) due = 30;
  else { const m = t.match(/(?:within|in|next)\s+(\d+)\s+days?/); if (m) due = +m[1]; }
  return {
    categories, cities,
    max_bill_cents: under ? money(under[1]) : undefined,
    due_within_days: due,
    budget_cents: Math.min(10_000_000, Math.max(1000, (budgetM ? money(budgetM[1]) : undefined) ?? 1_000_000)),
  };
}
