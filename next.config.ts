import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: minimal production server for Docker (copies only
  // traced files into .next/standalone). Safe — no route/build change,
  // same `next start` semantics via server.js.
  output: 'standalone',
  serverExternalPackages: ['ffmpeg-static', 'sharp'],
  // Allow dev-only requests (HMR, chunks) from local and tunnel hostnames.
  allowedDevOrigins: ['127.0.0.1', 'socialpulse.dotstark.tech'],
};

export default nextConfig;
