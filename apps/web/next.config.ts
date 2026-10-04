import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: minimal production server for Docker (copies only
  // traced files into .next/standalone). Safe — no route/build change,
  // same `next start` semantics via server.js.
  output: 'standalone',
  serverExternalPackages: ['ffmpeg-static', 'sharp'],
  // Allow dev-only requests (HMR, chunks) from local and tunnel hostnames.
  allowedDevOrigins: ['127.0.0.1', 'socialpulse.dotstark.tech'],
  // Next normally answers any trailing slash with a 308 BEFORE proxy runs, so
  // `/superadmin/` redirected instead of 404-ing and the URL still responded.
  // Disabling that lets proxy decide per-path: src/proxy.ts now re-applies the
  // exact same slash-stripping redirect for every other route, so behaviour is
  // unchanged everywhere except the paths we want to disappear.
  skipTrailingSlashRedirect: true,
  // Same reason: Next otherwise collapses duplicate slashes ahead of the
  // proxy and 308s, so `//superadmin` answered instead of 404-ing.
  skipProxyUrlNormalize: true,
};

export default nextConfig;
