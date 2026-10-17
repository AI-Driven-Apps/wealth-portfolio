// Build step after migrate, driven by DATA_MODE (see src/lib/config.ts):
//   sample: load the fictional household — but refuse if this database holds real
//           data, so a Preview deployment pointed at the production database fails
//           the build instead of mixing demo rows into your portfolio.
//   live:   no demo. REMOVE_SAMPLE_DATA=1 deletes a demo left over from before;
//           then the first admin comes from ADMIN_EMAIL / ADMIN_PASSWORD.
import { closeDb, useMigrationUrl, explainDbError } from "../src/lib/db";
import { config } from "../src/lib/config";
import { hashPassword } from "../src/lib/auth/password";
import { hasSampleData, realDataSummary, removeSampleData, seedSample } from "../src/lib/sample";
import { bootstrapAdmin } from "../src/lib/bootstrap";
import { FEATURES } from "../src/lib/features";

async function main() {
  useMigrationUrl();
  console.log(`DATA_MODE=${config.dataMode}`);
  if (config.isSample) {
    const real = await realDataSummary();
    if (real) throw new Error(`This database holds real data (${real}); refusing to load sample data into it. Give this environment its own database (DATABASE_URL / MIGRATION_DATABASE_URL), or set DATA_MODE=live.`);
    const r = await seedSample(process.env.SAMPLE_PASSWORD ?? "sample-portfolio-2026", hashPassword, FEATURES.filter((f) => f.built).map((f) => f.key));
    console.log("sample household:", r);
    return;
  }
  if (await hasSampleData()) {
    if (process.env.REMOVE_SAMPLE_DATA === "1") console.log("removed sample data:", await removeSampleData());
    else console.warn("This live database still has the sample household and logins. Set REMOVE_SAMPLE_DATA=1 for one deploy to remove them.");
  }
  console.log(await bootstrapAdmin());
}

main().then(closeDb).catch(async (e) => {
  console.error(`\nprepare-data failed: ${explainDbError(e)}\n`);
  await closeDb();
  process.exit(1);
});
