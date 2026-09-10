import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['ffmpeg-static', 'sharp'],
  // Allow dev-only requests (HMR, chunks) from local and tunnel hostnames.
  allowedDevOrigins: ['127.0.0.1', 'socialpulse.dotstark.tech'],
};

export default nextConfig;
