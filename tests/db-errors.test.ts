import { describe, it, expect } from "vitest";
import { explainDbError } from "@/lib/db";

describe("explainDbError", () => {
  it("explains the Supabase IPv6 direct-host failure seen on Vercel builds", () => {
    // Shape of the real error: DrizzleQueryError -> cause: socket error with code + address
    const err = Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"'), {
      cause: Object.assign(new Error("connect ENETUNREACH 2406:da1a:b00:1301:7804:b5e1:1713:1a41:5432 - Local (:::0)"), {
        code: "ENETUNREACH", address: "2406:da1a:b00:1301:7804:b5e1:1713:1a41", port: 5432,
      }),
    });
    expect(explainDbError(err)).toMatch(/IPv6.*Session pooler/);
  });
  it("explains pooler username mistakes", () => {
    expect(explainDbError(Object.assign(new Error("x"), { cause: { code: "28P01", message: "password authentication failed" } }))).toMatch(/postgres\.<project-ref>/);
  });
});
