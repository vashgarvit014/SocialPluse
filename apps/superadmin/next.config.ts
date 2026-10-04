import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output: minimal production server for Docker, same as
  // apps/web.
  output: 'standalone',
};

export default nextConfig;
