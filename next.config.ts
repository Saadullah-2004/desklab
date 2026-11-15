import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false,
  // The live commerce endpoints explicitly opt out of static rendering.
};

export default nextConfig;
