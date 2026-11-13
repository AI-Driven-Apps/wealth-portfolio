import type { Metadata } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/auth/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Wealth Portfolio", template: "%s · Wealth Portfolio" },
  description: "Household portfolio tracker: mutual funds, SIPs, stocks and ETFs.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "mono" ? "mono" : undefined;
  return (
    <html lang="en-IN" data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
