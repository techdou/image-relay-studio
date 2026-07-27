import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],

  // Request body size limit (prevents memory exhaustion from oversized payloads)
  serverExternalPackages: [],
  experimental: {
    // Max body size: 10MB for upload endpoints, 1MB default for others
    // (Next.js defaults to 1MB; upload routes handle larger via streaming)
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
