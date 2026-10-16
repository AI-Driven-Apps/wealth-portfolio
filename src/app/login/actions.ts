"use server";
import { redirect } from "next/navigation";
import { login } from "@/lib/auth/session";

export async function loginAction(_: unknown, fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/");
  if (!email || !password) return { error: "Enter your email and password." };
  const r = await login(email, password);
  if (!r.ok) return { error: r.error };
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
