// Central env config. DEPLOY_TARGET drives defaults; AI agents and imports
// are forced off on Vercel, which runs as a sample-data demo.
export type DeployTarget = "pi" | "vercel";

const target = (process.env.DEPLOY_TARGET ?? (process.env.VERCEL ? "vercel" : "pi")) as DeployTarget;

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export const config = {
  target,
  isVercel: target === "vercel",
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Build-time scripts (migrate, seed) may use a different URL, e.g. Supabase's
  // session pooler, while the app uses the transaction pooler.
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // The Vercel build is a sample-data demo: no real statements are uploaded there.
  importsEnabled: target === "vercel" ? false : bool(process.env.IMPORTS_ENABLED, true),
  aiAgentsEnabled: target === "vercel" ? false : bool(process.env.AI_AGENTS_ENABLED, false),
  parserUrl: process.env.PARSER_URL ?? "http://cas-parser:8001",
  dhanClientId: (process.env.DHAN_CLIENT_ID ?? "").trim().replace(/^['"]|['"]$/g, ""),
  backfillDays: Number(process.env.BACKFILL_DAYS ?? 730),
  panPepper: process.env.PAN_PEPPER ?? "",
  secureCookies: bool(process.env.SECURE_COOKIES, process.env.NODE_ENV === "production"),
};

export function requireSecret(name: "jwtSecret" | "cronSecret"): string {
  const v = config[name];
  if (!v || v.length < 32) throw new Error(`${name === "jwtSecret" ? "JWT_SECRET" : "CRON_SECRET"} must be set (32+ chars)`);
  return v;
}
