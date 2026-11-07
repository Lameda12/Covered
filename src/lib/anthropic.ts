import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { extractedBill, sweepFilters, CATEGORIES, type ExtractedBill, type SweepFilters } from "@/lib/validation";

export const MODEL = "claude-sonnet-5-5";
let client: Anthropic | undefined;
const api = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }));

/** Pull the first JSON object out of a model reply (tolerates code fences). */
function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  return JSON.parse(text.slice(start, end + 1));
}

const textOf = (r: Anthropic.Message) => r.content.map((b) => (b.type === "text" ? b.text : "")).join("");

export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

/** Read a bill photo/PDF into structured fields. Returns null if it can't be read (caller falls back to manual entry). */
export async function readBill(data: Buffer, mime: ImageMime): Promise<ExtractedBill | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const today = new Date().toISOString().slice(0, 10);
  const source = { type: "base64" as const, data: data.toString("base64") };
  const file = mime === "application/pdf"
    ? { type: "document" as const, source: { ...source, media_type: "application/pdf" as const } }
    : { type: "image" as const, source: { ...source, media_type: mime } };
  try {
    const res = await api().messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          file,
          { type: "text", text:
`Read this bill. Reply with JSON only, no prose, exactly:
{"category": one of ${JSON.stringify(CATEGORIES)} or null, "biller_name": string or null, "account_last4": last 4 characters of the account number or null (NEVER the full number), "amount_due": number in dollars (the amount currently due) or null, "due_date": "YYYY-MM-DD" or null, "confidence": number 0 to 1}
Today is ${today}. Use null for anything you cannot read. If this is not a bill, set confidence to 0.` },
        ],
      }],
    });
    return extractedBill.parse(parseJson(textOf(res)));
  } catch (e) {
    console.error("readBill failed", e);
    return null;
  }
}

/** Turn "heat bills in Winnipeg under $400, due this week, $10k" into filters. Null if Claude is unavailable. */
export async function parseSweepWithClaude(text: string, knownCities: string[]): Promise<SweepFilters | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await api().messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: "user",
        content:
`Convert this request to sweep filters. Reply with JSON only:
{"categories": subset of ${JSON.stringify(CATEGORIES)} ([] = all), "cities": array of city names ([] = all; known cities: ${JSON.stringify(knownCities)}), "max_bill_cents": integer cents or omit, "due_within_days": integer or omit ("this week" = 7), "budget_cents": integer cents (required; "$10k" = 1000000)}
Request: ${JSON.stringify(text)}`,
      }],
    });
    return sweepFilters.parse(parseJson(textOf(res)));
  } catch (e) {
    console.error("parseSweep failed", e);
    return null;
  }
}
