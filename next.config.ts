import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // pdf-parse ships its own pdf.js worker; bundling it breaks worker resolution.
  serverExternalPackages: ['pdf-parse'],
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
