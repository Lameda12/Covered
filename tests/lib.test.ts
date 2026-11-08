import { describe, expect, it } from "vitest";
import { cardFeeCents } from "@/lib/money";
import { safeNext } from "@/lib/redirect";
import { parseSweepHeuristic, planSweep, type PlanBill } from "@/lib/sweep";
import { billDraft, checkoutInput, sweepFilters } from "@/lib/validation";

const today = new Date("2026-11-07T12:00:00Z");
const d = (n: number) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);
const bill = (id: string, o: Partial<PlanBill> = {}): PlanBill => ({ id, category: "heat", city: "Winnipeg", biller_name: "Northern Gas Co.", due_date: d(3), amount_cents: 30000, funded_cents: 0, ...o });

describe("planSweep", () => {
  it("fills by due date within budget and skips what doesn't fit", () => {
    const bills = [bill("a", { due_date: d(2), amount_cents: 30000 }), bill("b", { due_date: d(5), amount_cents: 25000 }), bill("c", { due_date: d(6), amount_cents: 15000 })];
    const p = planSweep(bills, { categories: ["heat"], cities: ["winnipeg"], budget_cents: 50000, due_within_days: 7 }, today);
    expect(p.take.map((b) => b.id)).toEqual(["a", "c"]);
    expect(p.spend).toBe(45000);
    expect(p.leftover).toBe(5000);
  });
  it("honours max per bill, category, city and due window", () => {
    const bills = [bill("big", { amount_cents: 90000 }), bill("det", { city: "Detroit" }), bill("rent", { category: "rent" }), bill("late", { due_date: d(20) }), bill("ok")];
    const p = planSweep(bills, { categories: ["heat"], cities: ["Winnipeg"], max_bill_cents: 40000, due_within_days: 7, budget_cents: 1_000_000 }, today);
    expect(p.take.map((b) => b.id)).toEqual(["ok"]);
  });
});

describe("parseSweepHeuristic", () => {
  it("parses the example sentence", () => {
    const f = parseSweepHeuristic("heat bills in Winnipeg under $400, due this week, $10k", ["Winnipeg", "Detroit"]);
    expect(f).toMatchObject({ categories: ["heat"], cities: ["Winnipeg"], max_bill_cents: 40000, due_within_days: 7, budget_cents: 1_000_000 });
  });
});

describe("validation and helpers", () => {
  it("caps bills at $1,500 and rejects bad input", () => {
    const ok = { category: "rent", biller_name: "X", amount_dollars: "1500", due_date: "2026-12-01", city: "A", first_name: "B", image_path: "uploads/x" };
    expect(billDraft.safeParse(ok).success).toBe(true);
    expect(billDraft.safeParse({ ...ok, amount_dollars: "1500.01" }).success).toBe(false);
    expect(billDraft.safeParse({ ...ok, note: "x".repeat(141) }).success).toBe(false);
    expect(billDraft.safeParse({ ...ok, category: "yacht" }).success).toBe(false);
    expect(checkoutInput.safeParse({ billId: "nope", mode: "cover" }).success).toBe(false);
    expect(sweepFilters.safeParse({ budget_cents: 5 }).success).toBe(false);
  });
  it("card fee grosses up so the net equals the amount", () => {
    for (const c of [1000, 2500, 150000]) {
      const net = (c + cardFeeCents(c)) * (1 - 0.029) - 30;
      expect(Math.abs(net - c)).toBeLessThan(1.5);
    }
  });
  it("safeNext blocks open redirects", () => {
    expect(safeNext("/receipts")).toBe("/receipts");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", null, ""]) expect(safeNext(bad)).toBe("/");
  });
});
