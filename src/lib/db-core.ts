import postgres from "postgres";

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  // max 5: Workers allow few simultaneous connections per invocation; Hyperdrive does the real pooling.
  return postgres(url, {
    max: 5, fetch_types: false, idle_timeout: 5, connect_timeout: 10,
    // keep `date` columns as 'YYYY-MM-DD' strings (not JS Dates) so they serialize cleanly to the client
    types: { date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x } },
  });
}
