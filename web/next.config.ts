import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // web-push pulls in Node crypto/https helpers; keep it out of the bundle.
  serverExternalPackages: ['web-push'],
  // Self-hosting (Docker) runs the standalone server; Vercel ignores this.
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      // API responses are live data — never cache them anywhere. Photos are the
      // exception: immutable by id, they set their own long-lived private cache.
      { source: '/api/:path((?!photos/).*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
