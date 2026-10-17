// Loads the fictional sample household by hand (local testing). Safe to re-run.
// Refuses a database with real data in it. SAMPLE_PASSWORD sets the demo password.
import { closeDb, useMigrationUrl, explainDbError } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { realDataSummary, seedSample } from "../src/lib/sample";
import { FEATURES } from "../src/lib/features";

async function main() {
  useMigrationUrl();
  const real = await realDataSummary();
  if (real) throw new Error(`This database holds real data (${real}); not loading sample data into it.`);
  const r = await seedSample(process.env.SAMPLE_PASSWORD ?? "sample-portfolio-2026", hashPassword, FEATURES.filter((f) => f.built).map((f) => f.key));
  console.log("sample household:", r);
}

main().then(closeDb).catch(async (e) => {
  console.error(`\nseed failed: ${explainDbError(e)}\n`);
  await closeDb();
  process.exit(1);
});
