import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "../config";

// One pool per process, created lazily so `next build` never needs a database.
// On Vercel each function instance holds a tiny pool; prepare:false keeps it
// compatible with PgBouncer / Neon pooled connection strings.
type DB = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { __wpDb?: DB; __wpSql?: postgres.Sql; __wpMigrate?: boolean };

/** Scripts call this first to connect with MIGRATION_DATABASE_URL (falls back to DATABASE_URL). */
export function useMigrationUrl() { g.__wpMigrate = true; }

export function getDb(): DB {
  if (!g.__wpDb) {
    const url = g.__wpMigrate ? config.migrationDatabaseUrl : config.databaseUrl;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__wpSql = postgres(url, {
      max: config.isVercel ? 3 : 8,
      prepare: !config.isVercel,
      idle_timeout: 20,
      onnotice: () => {},
    });
    g.__wpDb = drizzle(g.__wpSql, { schema });
  }
  return g.__wpDb;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const inst = getDb();
    const v = Reflect.get(inst, prop, inst);
    return typeof v === "function" ? v.bind(inst) : v;
  },
});

/** Turn connection failures into an actionable message (most common: Supabase IPv6 direct host on Vercel). */
export function explainDbError(e: unknown): string {
  // Drizzle wraps the driver error, which wraps the socket error: check the whole chain.
  const chain: { code?: string; address?: string; message?: string; cause?: unknown }[] = [];
  for (let x = e as { cause?: unknown } | undefined, i = 0; x && i < 6; x = x.cause as typeof x, i++) chain.push(x as never);
  const net = chain.find((c) => c.code === "ENETUNREACH" || c.code === "EHOSTUNREACH");
  if (net && (net.address ?? "").includes(":")) {
    return "Database host resolved to an IPv6 address, which this network (e.g. Vercel builds) cannot reach. " +
      "With Supabase, use a pooler connection string instead of the direct db.<ref>.supabase.co one: " +
      "Supabase dashboard -> Connect -> Session pooler for MIGRATION_DATABASE_URL and Transaction pooler for DATABASE_URL.";
  }
  if (chain.some((c) => c.code === "ENOTFOUND")) return "Database host name not found. Check DATABASE_URL.";
  if (chain.some((c) => c.code === "28P01" || /password authentication failed/i.test(c.message ?? ""))) {
    return "Database password rejected. With the Supabase pooler the user is postgres.<project-ref>, not postgres.";
  }
  return chain.at(-1)?.message ?? String(e);
}

export async function closeDb() {
  await g.__wpSql?.end({ timeout: 5 });
  g.__wpDb = undefined;
  g.__wpSql = undefined;
}

export type { DB };
export { schema };
