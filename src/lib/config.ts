// Central env config. Two independent switches:
//   DEPLOY_TARGET (pi | vercel): where it runs — worker vs Vercel Cron, DB pool, Dhan.
//   DATA_MODE (live | sample): whose data — real household, or the fictional demo.
// Vercel defaults to sample and the Pi to live; set DATA_MODE per Vercel
// environment (Production = live, Preview = sample), each with its own database.
export type DeployTarget = "pi" | "vercel";
export type DataMode = "live" | "sample";

const target = (process.env.DEPLOY_TARGET ?? (process.env.VERCEL ? "vercel" : "pi")) as DeployTarget;
const dataMode: DataMode = (process.env.DATA_MODE ?? "").toLowerCase() === "live" ? "live"
  : (process.env.DATA_MODE ?? "").toLowerCase() === "sample" ? "sample"
  : target === "vercel" ? "sample" : "live";
const isSample = dataMode === "sample";
// On Vercel the PDF parser can't be the internal container, so PDF imports need an
// explicit https PARSER_URL plus PARSER_SECRET (PDFs and passwords cross the internet).
const parserUrl = process.env.PARSER_URL || (target === "vercel" ? "" : "http://cas-parser:8001");

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined || v === "" ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

export const config = {
  target,
  isVercel: target === "vercel",
  dataMode,
  isSample,
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Build-time scripts (migrate, seed) may use a different URL, e.g. Supabase's
  // session pooler, while the app uses the transaction pooler.
  migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // The sample demo takes no real statements.
  importsEnabled: isSample ? false : bool(process.env.IMPORTS_ENABLED, true),
  // Off the Pi the parser is on the internet: https and a shared secret, or no PDF imports.
  pdfImportsEnabled: !isSample && bool(process.env.IMPORTS_ENABLED, true)
    && (target === "pi" ? !!parserUrl : /^https:\/\//.test(parserUrl) && (process.env.PARSER_SECRET ?? "").length >= 16),
  aiAgentsEnabled: target === "vercel" ? false : bool(process.env.AI_AGENTS_ENABLED, false),
  parserUrl,
  dhanClientId: (process.env.DHAN_CLIENT_ID ?? "").trim().replace(/^['"]|['"]$/g, ""),
  backfillDays: Number(process.env.BACKFILL_DAYS ?? 730),
  panPepper: process.env.PAN_PEPPER ?? "",
  // Encrypts stored Discord webhook URLs. Falls back to JWT_SECRET; set it separately
  // if you want rotating the session secret not to require re-entering webhooks.
  alertsKey: process.env.ALERTS_KEY || process.env.JWT_SECRET || "",
  secureCookies: bool(process.env.SECURE_COOKIES, process.env.NODE_ENV === "production"),
};

export function requireSecret(name: "jwtSecret" | "cronSecret"): string {
  const v = config[name];
  if (!v || v.length < 32) throw new Error(`${name === "jwtSecret" ? "JWT_SECRET" : "CRON_SECRET"} must be set (32+ chars)`);
  return v;
}
