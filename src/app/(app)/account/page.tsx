import { cookies } from "next/headers";
import { requireCtx } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { THEME_COOKIE } from "@/lib/auth/tokens";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "./form";
import { setTheme } from "../actions";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireCtx();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "mono" ? "mono" : "default";
  const chip = (active: boolean) => `rounded-md px-3 py-1.5 text-[13px] ${active ? "bg-accent-soft font-semibold text-accent" : "border border-line text-ink-2 hover:bg-panel-2"}`;
  return (
    <>
      <PageHeader title="Account" sub={`${ctx.user.name} · ${ctx.user.email} · ${ctx.user.role}`} />
      <Card title="Change password"><PasswordForm /></Card>
      <Card title="Theme" className="mt-4">
        <div className="flex gap-2">
          <form action={setTheme}><input type="hidden" name="theme" value="default" /><button className={chip(theme === "default")}>Default</button></form>
          <form action={setTheme}><input type="hidden" name="theme" value="mono" /><button className={chip(theme === "mono")}>Monospace</button></form>
        </div>
      </Card>
      <form action={`${config.basePath}/api/auth/logout`} method="post" className="mt-4"><button className="text-[13px] text-ink-2 underline">Sign out</button></form>
    </>
  );
}
