import { hash, verify } from "@node-rs/argon2";

// argon2id with OWASP-recommended minimums; ~60 ms on a Pi 5.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, OPTS);
export const verifyPassword = async (h: string, pw: string) => {
  try { return await verify(h, pw); } catch { return false; }
};

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use letters and at least one number.";
  return null;
}
