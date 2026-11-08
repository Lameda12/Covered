import { z } from "zod";

export const CATEGORIES = ["rent", "electric", "heat", "water", "internet", "phone", "medical", "childcare", "car"] as const;
export type Category = (typeof CATEGORIES)[number];
export const MAX_BILL_CENTS = 150_000;
export const MAX_SWEEP_CENTS = 10_000_000;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const checkoutInput = z.object({
  billId: z.string().uuid(),
  mode: z.enum(["cover", "chip"]),
  amountCents: z.number().int().min(500).max(MAX_BILL_CENTS).optional(),
  coverFee: z.boolean().default(false),
});

export const billDraft = z.object({
  category: z.enum(CATEGORIES),
  biller_name: trimmed(80),
  account_last4: z.string().trim().regex(/^[0-9A-Za-z]{2,4}$/, "Last 4 characters of the account number").or(z.literal("")).optional(),
  amount_dollars: z.coerce.number().min(1).max(MAX_BILL_CENTS / 100),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  city: trimmed(40),
  first_name: trimmed(30),
  note: z.string().trim().max(140).optional(),
  image_path: z.string().min(1).max(200),
});
export type BillDraft = z.infer<typeof billDraft>;

/** What Claude returns for a bill image. */
export const extractedBill = z.object({
  category: z.enum(CATEGORIES).nullable().optional(),
  biller_name: z.string().max(120).nullable().optional(),
  account_last4: z.string().regex(/^[0-9A-Za-z]{2,4}$/).nullable().optional(),
  amount_due: z.number().nonnegative().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0),
});
export type ExtractedBill = z.infer<typeof extractedBill>;

export const sweepFilters = z.object({
  categories: z.array(z.enum(CATEGORIES)).max(9).default([]),
  cities: z.array(trimmed(40)).max(20).default([]),
  max_bill_cents: z.number().int().min(100).max(MAX_BILL_CENTS).optional(),
  due_within_days: z.number().int().min(1).max(60).optional(),
  budget_cents: z.number().int().min(1000).max(MAX_SWEEP_CENTS),
});
export type SweepFilters = z.infer<typeof sweepFilters>;

export const email = z.string().trim().toLowerCase().email().max(200);
export const thankYou = z.object({ token: z.string().regex(/^[0-9a-f]{48}$/), body: z.string().trim().min(1).max(200) });
export const sweepText = z.string().trim().min(3).max(300);
export const rejectInput = z.object({ billId: z.string().uuid(), reason: trimmed(300) });
export const payoutInput = z.object({ billId: z.string().uuid(), confirmation: z.string().trim().min(3).max(80) });
