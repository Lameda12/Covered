import "server-only";

export type PayoutRequest = {
  billId: string;
  billerName: string;
  accountLast4: string | null;
  amountCents: number;
  confirmation: string;
  proofPath?: string;
};
export type PayoutResult = { confirmation: string; proofPath?: string };

/**
 * How a funded bill actually gets paid to its biller.
 * v1 = ManualProvider: an admin pays outside the app and records the confirmation.
 * TODO(v2): automated biller payments, e.g. an `ApiProvider` that calls a bill-pay API and
 * returns the confirmation number itself (set `requiresAdminAction = false`).
 */
export interface BillPayProvider {
  readonly name: string;
  readonly requiresAdminAction: boolean;
  settle(req: PayoutRequest): Promise<PayoutResult>;
}

export class ManualProvider implements BillPayProvider {
  readonly name = "manual";
  readonly requiresAdminAction = true;
  async settle(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.confirmation.trim()) throw new Error("A confirmation number from the biller is required.");
    return { confirmation: req.confirmation.trim(), proofPath: req.proofPath };
  }
}

export const payProvider = (): BillPayProvider => new ManualProvider();
