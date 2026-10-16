import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { PageHeader, Card, Badge, btnGhost, btnDanger } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { fmtDate } from "@/lib/format";
import { createUser, resetPassword, updateUser, createProfile, renameProfile, deleteProfile } from "./actions";

export const metadata = { title: "Users & profiles" };

export default async function AdminUsers() {
  const ctx = await requireAdmin();
  const users = await db.select().from(schema.appUser).orderBy(asc(schema.appUser.name));
  const profiles = await db.select().from(schema.profile).orderBy(asc(schema.profile.name));
  const access = await db.select().from(schema.profileAccess);
  const owners = (pid: string) => users.filter((u) => access.some((a) => a.profileId === pid && a.userId === u.id && u.role === "member")).map((u) => u.name);

  return (
    <>
      <PageHeader title="Users & profiles" sub="A login is a user; a profile is whose money it is. Members see only their own profile; admins see every profile and the household total." />
      <Card title="Users" pad={false}>
        <div className="overflow-x-auto"><table>
          <thead><tr><th>User</th><th>Role</th><th>Profile</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{users.map((u) => {
            const mine = access.filter((a) => a.userId === u.id);
            return (
              <tr key={u.id}>
                <td><div className="font-medium">{u.name}</div><div className="text-[12px] text-ink-3">{u.email}</div></td>
                <td>
                  <form action={updateUser} className="flex gap-1.5">
                    <input type="hidden" name="id" value={u.id} />
                    <select name="role" defaultValue={u.role} disabled={u.id === ctx.user.id}><option value="member">Member</option><option value="admin">Admin</option></select>
                    {u.id !== ctx.user.id && <button className={btnGhost}>Set</button>}
                  </form>
                </td>
                <td>
                  {u.role === "admin" ? <span className="text-ink-2">All profiles</span> : (
                    <form action={updateUser} className="flex gap-1.5">
                      <input type="hidden" name="id" value={u.id} />
                      <select name="profileId" defaultValue={mine[0]?.profileId ?? ""}>
                        <option value="">— none —</option>
                        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select name="level" defaultValue={mine[0]?.level ?? "manage"} aria-label="Access level"><option value="manage">Can edit</option><option value="view">View only</option></select>
                      <button className={btnGhost}>Save</button>
                    </form>
                  )}
                </td>
                <td>{u.isActive ? (u.mustChangePassword ? <Badge kind="warn">Temp password</Badge> : <Badge kind="accent">Active</Badge>) : <Badge>Disabled</Badge>}</td>
                <td className="text-ink-2">{u.lastLoginAt ? fmtDate(u.lastLoginAt.toISOString()) : "never"}</td>
                <td className="r">
                  {u.id !== ctx.user.id && (
                    <div className="flex justify-end gap-1.5">
                      <ActionForm action={resetPassword} submit="Reset password" ghost><input type="hidden" name="id" value={u.id} /></ActionForm>
                      <form action={updateUser}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="isActive" value={u.isActive ? "false" : "true"} /><button className={u.isActive ? btnDanger : btnGhost}>{u.isActive ? "Disable" : "Enable"}</button></form>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Add a user">
          <ActionForm action={createUser} submit="Create user" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label htmlFor="nu-name">Name</label><input id="nu-name" name="name" required /></div>
              <div className="flex flex-col gap-1"><label htmlFor="nu-email">Email</label><input id="nu-email" name="email" type="email" required /></div>
              <div className="flex flex-col gap-1"><label htmlFor="nu-role">Role</label><select id="nu-role" name="role" defaultValue="member"><option value="member">Member</option><option value="admin">Admin</option></select></div>
              <div className="flex flex-col gap-1"><label htmlFor="nu-prof">Their profile</label>
                <select id="nu-prof" name="profileId" defaultValue=""><option value="">Create a new one…</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
              <div className="flex flex-col gap-1 sm:col-span-2"><label htmlFor="nu-np">New profile name (if creating)</label><input id="nu-np" name="newProfile" placeholder="e.g. Amma" /></div>
            </div>
            <p className="text-[12px] text-ink-3">A temporary password is shown once after creating. New members get no modules until you grant them under Features.</p>
          </ActionForm>
        </Card>
        <Card title="Profiles">
          <ul className="mb-4 divide-y divide-line">
            {profiles.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <form action={renameProfile} className="flex flex-1 gap-1.5"><input type="hidden" name="id" value={p.id} /><input name="name" defaultValue={p.name} className="flex-1" aria-label="Profile name" /><button className={btnGhost}>Rename</button></form>
                <span className="text-[12px] text-ink-3">{p.panLast4 ? `PAN ••••${p.panLast4}` : "no PAN"}{owners(p.id).length ? ` · ${owners(p.id).join(", ")}` : ""}</span>
                <form action={deleteProfile}><input type="hidden" name="id" value={p.id} /><button className={btnDanger} title="Only empty profiles can be deleted">Delete</button></form>
              </li>
            ))}
          </ul>
          <ActionForm action={createProfile} submit="Add profile" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1"><label htmlFor="np-name">Name</label><input id="np-name" name="name" required /></div>
              <div className="flex flex-col gap-1"><label htmlFor="np-pan">PAN (optional)</label><input id="np-pan" name="pan" placeholder="ABCDE1234F" autoComplete="off" /></div>
            </div>
            <p className="text-[12px] text-ink-3">PAN is stored only as a keyed hash plus the last 4 characters.</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
