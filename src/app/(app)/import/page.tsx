import { desc, eq, inArray } from "drizzle-orm";
import { requireCtx } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { PageHeader, Card, Notice, btnDanger, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Importer } from "./importer";
import { undoImport } from "./actions";

export const metadata = { title: "Import" };
const SRC: Record<string, string> = { cas: "MF statement", demat_cas: "Demat statement", tradebook: "Tradebook", contract_note: "Contract note", spreadsheet: "Spreadsheet", fixed_assets: "Deposits & savings", loans: "Loans" };

export default async function ImportPage() {
  const ctx = await requireCtx("imports");
  if (!config.importsEnabled) return <Empty title="Imports are off on this deployment">{config.isSample ? "This deployment runs on fictional sample data only." : "IMPORTS_ENABLED is off."}</Empty>;
  const batches = ctx.profileIds.length ? await db.select({ b: schema.importBatch, profile: schema.profile.name })
    .from(schema.importBatch).innerJoin(schema.profile, eq(schema.profile.id, schema.importBatch.profileId))
    .where(inArray(schema.importBatch.profileId, ctx.profileIds)).orderBy(desc(schema.importBatch.createdAt)).limit(30) : [];
  const single = ctx.scope !== "household" && !!ctx.scope && ctx.canManage;
  const profileName = ctx.profiles.find((p) => p.id === ctx.scope)?.name;

  return (
    <>
      <PageHeader title="Import" sub={single ? <>Importing into <b>{profileName}</b>. Re-importing the same file is safe: rows already saved are skipped.</> : undefined} />
      {single ? <Importer basePath={config.basePath} features={[...ctx.features]} pdf={config.pdfImportsEnabled} /> : <Notice kind="info">{ctx.scope === "household" ? "Switch to a single profile first: imports go into one person's portfolio." : "You have view-only access to this profile."}</Notice>}
      <Card title="Import history" className="mt-6" pad={false}>
        {!batches.length ? <p className="px-4 py-6 text-ink-3">No imports yet.</p> : (
          <div className="overflow-x-auto"><table>
            <thead><tr><th>When</th><th>Type</th><th>File</th>{ctx.scope === "household" && <th>Profile</th>}<th className="r">Saved</th><th className="r">Already there</th><th /></tr></thead>
            <tbody>{batches.map(({ b, profile }) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap">{fmtDate(b.createdAt.toISOString())}</td>
                <td>{SRC[b.kind] ?? b.kind}</td>
                <td className="max-w-[280px] truncate text-ink-2">{b.filename}</td>
                {ctx.scope === "household" && <td className="text-ink-2">{profile}</td>}
                <td className="r num">{b.stats?.inserted ?? 0}{b.stats?.events ? <span className="text-ink-3"> + {b.stats.events} events</span> : null}</td>
                <td className="r num">{b.stats?.duplicates ?? 0}</td>
                <td className="r">{ctx.canManage && <form action={undoImport}><input type="hidden" name="id" value={b.id} /><button className={btnDanger} title="Remove everything this import added">Undo</button></form>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
