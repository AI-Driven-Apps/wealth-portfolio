import type { NextConfig } from "next";

// basePath is fixed at build time. The Pi image is built with
// NEXT_PUBLIC_BASE_PATH=/wealth so Caddy can serve it at home.tinyserverlab.in/wealth;
// Vercel builds leave it empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const config: NextConfig = {
  output: "standalone",
  basePath,
  serverExternalPackages: ["@node-rs/argon2", "postgres"],
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
};

export default config;
