import { requireCtx } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { PageHeader, Card } from "@/components/ui";
import { PasswordForm } from "./form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await requireCtx();
  return (
    <>
      <PageHeader title="Account" sub={`${ctx.user.name} · ${ctx.user.email} · ${ctx.user.role}`} />
      <Card title="Change password"><PasswordForm /></Card>
      <form action={`${config.basePath}/api/auth/logout`} method="post" className="mt-4"><button className="text-[13px] text-ink-2 underline">Sign out</button></form>
    </>
  );
}
