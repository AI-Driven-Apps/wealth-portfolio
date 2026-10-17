import { describe, it, expect } from "vitest";
import { replay, seriesPriceAt, fdPriceAt, asLumpSum, stoppedAfter } from "@/lib/calc/whatif";
import { computeDrift, targetsProblem } from "@/lib/calc/drift";
import { parseWebhook, encryptSecret, decryptSecret } from "@/lib/notify/discord";

const series = [
  { date: "2024-01-01", close: 10 }, { date: "2024-07-01", close: 12 }, { date: "2025-01-01", close: 15 }, { date: "2026-01-01", close: 20 },
];

describe("what-if replay", () => {
  it("buys at each date's price and values at the last", () => {
    const r = replay([{ date: "2024-01-01", amount: -1000 }, { date: "2025-01-01", amount: -1500 }], seriesPriceAt(series), "2026-01-01");
    expect(r.units).toBeCloseTo(200);
    expect(r.value).toBeCloseTo(4000);
    expect(r.invested).toBe(2500);
    expect(r.xirr).toBeGreaterThan(0);
  });
  it("withdrawals take rupees out; any excess is a shortfall", () => {
    const r = replay([{ date: "2024-01-01", amount: -1000 }, { date: "2024-07-01", amount: 600 }, { date: "2025-01-01", amount: 5000 }], seriesPriceAt(series), "2026-01-01");
    expect(r.withdrawn).toBeCloseTo(600 + 750); // 50 units left at 15
    expect(r.shortfall).toBeCloseTo(4250);
    expect(r.value).toBe(0);
  });
  it("skips investments before the alternative has a price", () => {
    const r = replay([{ date: "2023-06-01", amount: -1000 }, { date: "2024-07-01", amount: -1200 }], seriesPriceAt(series), "2026-01-01");
    expect(r.skipped).toHaveLength(1);
    expect(r.value).toBeCloseTo(2000);
  });
  it("an FD alternative compounds at its rate", () => {
    const r = replay([{ date: "2024-01-01", amount: -100000 }], fdPriceAt(7, "2024-01-01"), "2025-01-01");
    expect(r.value).toBeCloseTo(100000 * Math.pow(1.0175, 4 * (366 / 365)), 0);
    expect(r.xirr).toBeCloseTo(0.0719, 3);
  });
  it("samples value over time", () => {
    const r = replay([{ date: "2024-01-01", amount: -1000 }], seriesPriceAt(series), "2026-01-01", ["2023-12-31", "2024-07-01", "2026-01-01"]);
    expect(r.series.map((p) => Math.round(p.value))).toEqual([0, 1200, 2000]);
  });
  it("lump sum and stop-after reshape the flows", () => {
    const flows = [{ date: "2024-01-01", amount: -100 }, { date: "2024-02-01", amount: -100 }, { date: "2024-03-01", amount: 50 }];
    expect(asLumpSum(flows)).toEqual([{ date: "2024-01-01", amount: -200 }, { date: "2024-03-01", amount: 50 }]);
    expect(stoppedAfter(flows, "2024-01-15")).toEqual([{ date: "2024-01-01", amount: -100 }, { date: "2024-03-01", amount: 50 }]);
  });
});

describe("drift", () => {
  it("compares with target and band", () => {
    const rows = computeDrift(new Map([["equity", 70], ["debt", 20], ["gold", 8], ["cash", 2]]), [
      { assetClass: "equity", targetPct: 60, bandPct: 5 }, { assetClass: "debt", targetPct: 25, bandPct: 5 }, { assetClass: "gold", targetPct: 15, bandPct: 5 },
    ], 5);
    const by = Object.fromEntries(rows.map((r) => [r.assetClass, r]));
    expect(by.equity.diff).toBeCloseTo(10);
    expect(by.equity.breached).toBe(true);
    expect(by.equity.toTarget).toBeCloseTo(-10);
    expect(by.debt.breached).toBe(false);
    expect(by.gold.breached).toBe(true);
    expect(by.cash.targeted).toBe(false);
    expect(by.cash.breached).toBe(false);
  });
  it("leaves a home out of the mix unless it has a target", () => {
    const cur = new Map([["equity", 60], ["debt", 40], ["real_estate", 500]]);
    const t = [{ assetClass: "equity", targetPct: 60, bandPct: 5 }, { assetClass: "debt", targetPct: 40, bandPct: 5 }];
    expect(computeDrift(cur, t, 5).map((r) => r.assetClass)).toEqual(["equity", "debt"]);
    expect(computeDrift(cur, t, 5).every((r) => !r.breached)).toBe(true);
    expect(computeDrift(cur, [...t.map((x) => ({ ...x, targetPct: x.targetPct / 2 })), { assetClass: "real_estate", targetPct: 50, bandPct: 5 }], 5)).toHaveLength(3);
  });
  it("targets must total 100", () => {
    expect(targetsProblem([{ assetClass: "equity", targetPct: 60 }, { assetClass: "debt", targetPct: 30 }])).toMatch(/90/);
    expect(targetsProblem([{ assetClass: "equity", targetPct: 60 }, { assetClass: "debt", targetPct: 40 }])).toBeNull();
  });
});

describe("discord", () => {
  it("accepts only Discord webhook URLs", () => {
    expect(parseWebhook("https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCD-1234")?.hint).toBe("1234");
    expect(parseWebhook("https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(parseWebhook("http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(parseWebhook("https://discord.com.evil.io/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz")).toBeNull();
  });
  it("encrypts webhooks so the stored value is useless without the key", () => {
    const secret = "x".repeat(40);
    const enc = encryptSecret("https://discord.com/api/webhooks/1/abc", secret);
    expect(enc).not.toContain("discord");
    expect(decryptSecret(enc, secret)).toBe("https://discord.com/api/webhooks/1/abc");
    expect(() => decryptSecret(enc, "y".repeat(40))).toThrow();
  });
});
