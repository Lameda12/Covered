export const dollars = (cents: number, digits = 2) =>
  "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Card fee a giver can opt to cover so the bill gets the full amount (2.9% + 30c, grossed up). */
export function cardFeeCents(cents: number): number {
  return Math.ceil((cents + 30) / (1 - 0.029)) - cents;
}

export function daysUntil(isoDate: string, now = new Date()): number {
  const d = new Date(isoDate + "T00:00:00Z").getTime();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d - t) / 864e5);
}
