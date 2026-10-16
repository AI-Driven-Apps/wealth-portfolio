import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Wealth Portfolio", template: "%s · Wealth Portfolio" },
  description: "Household portfolio tracker: mutual funds, SIPs, stocks and ETFs.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
