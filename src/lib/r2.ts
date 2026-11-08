import "server-only";
import { AwsClient } from "aws4fetch";
import { UserError } from "@/lib/auth";

// Private R2 bucket via its S3-compatible API. Presigned URLs are the only way bytes get in or out for users.
export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const KEY_RE = /^(uploads|proofs)\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

function cfg() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) throw new Error("R2 credentials missing");
  return {
    aws: new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    base: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET || "covered-bills"}`,
  };
}

async function presign(method: "PUT" | "GET", key: string, seconds: number, contentType?: string) {
  const { aws, base } = cfg();
  const req = await aws.sign(new Request(`${base}/${key}?X-Amz-Expires=${seconds}`, { method, headers: contentType ? { "Content-Type": contentType } : {} }), { aws: { signQuery: true } });
  return req.url;
}

export const presignPut = (key: string, contentType: string, seconds = 300) => presign("PUT", key, seconds, contentType);
/** Short-lived read URL. Only call after an ownership/admin check. */
export const presignGet = (key: string, seconds = 300) => presign("GET", key, seconds);

export function newKey(prefix: "uploads" | "proofs", contentType: string): string {
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new UserError("Please upload a JPG, PNG, WebP or PDF.");
  return `${prefix}/${crypto.randomUUID()}.${ext}`;
}

export async function getObject(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const { aws, base } = cfg();
  const res = await aws.fetch(`${base}/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 get ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
}

export async function putObject(key: string, body: Uint8Array | ArrayBuffer, contentType: string) {
  const { aws, base } = cfg();
  const res = await aws.fetch(`${base}/${key}`, { method: "PUT", body: body as BodyInit, headers: { "Content-Type": contentType } });
  if (!res.ok) throw new Error(`R2 put ${res.status}`);
}

export async function deleteObject(key: string) {
  const { aws, base } = cfg();
  await aws.fetch(`${base}/${key}`, { method: "DELETE" }).catch(() => {});
}
