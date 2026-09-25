import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // web-push pulls in Node crypto/https helpers; keep it out of the bundle.
  serverExternalPackages: ['web-push'],
  // Self-hosting (Docker) runs the standalone server; Vercel ignores this.
  output: 'standalone',
  // This folder is the app, even though the repo root has its own lockfile.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
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
