import "server-only";
import { connect, type Sql } from "@/lib/db-core";

export type { Sql };

/** Hyperdrive on Workers (pooled, regional), plain DATABASE_URL for local scripts. */
async function connectionString(): Promise<string> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const hd = (getCloudflareContext().env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    if (hd?.connectionString) return hd.connectionString;
  } catch {
    // not running inside the Workers runtime
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("No database: bind HYPERDRIVE or set DATABASE_URL");
  return url;
}

/** One short-lived client per request. The connection is closed after the response is on its way. */
export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = connect(await connectionString());
  try {
    return await fn(sql);
  } finally {
    const close = sql.end({ timeout: 2 }).catch(() => {});
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      getCloudflareContext().ctx.waitUntil(close);
    } catch {
      await close;
    }
  }
}
