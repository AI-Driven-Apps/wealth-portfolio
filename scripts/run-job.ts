// npm run job -- <name>   e.g. npm run job -- scheme-master
import { runJob, JOBS } from "../src/lib/jobs";
import { closeDb } from "../src/lib/db";

const name = process.argv[2];
if (!name || !JOBS[name]) {
  console.log("jobs:", Object.keys(JOBS).join(", "));
  process.exit(name ? 1 : 0);
}
runJob(name).then(async (r) => { console.log(JSON.stringify(r, null, 2)); await closeDb(); process.exit(r.status === "ok" ? 0 : 1); });
