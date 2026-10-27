import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// basePath is fixed at build time. The Pi image is built with
// NEXT_PUBLIC_BASE_PATH=/wealth so Caddy can serve it at home.tinyserverlab.in/wealth;
// Vercel builds leave it empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

// Build stamp shown in the sidebar. The Docker build has no .git, so the Pi passes
// GIT_SHA as a build arg; Vercel sets its own; local builds ask git.
function gitSha() {
  const sha = process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}

const config: NextConfig = {
  output: "standalone",
  basePath,
  env: { BUILD_SHA: gitSha(), BUILD_TIME: new Date().toISOString() },
  serverExternalPackages: ["@node-rs/argon2", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default config;
