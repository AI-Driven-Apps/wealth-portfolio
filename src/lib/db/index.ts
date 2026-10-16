import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { config } from "../config";

// One pool per process, created lazily so `next build` never needs a database.
// On Vercel each function instance holds a tiny pool; prepare:false keeps it
// compatible with PgBouncer / Neon pooled connection strings.
type DB = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { __wpDb?: DB; __wpSql?: postgres.Sql };

export function getDb(): DB {
  if (!g.__wpDb) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    g.__wpSql = postgres(config.databaseUrl, {
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

export async function closeDb() {
  await g.__wpSql?.end({ timeout: 5 });
  g.__wpDb = undefined;
  g.__wpSql = undefined;
}

export type { DB };
export { schema };
