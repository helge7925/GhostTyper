/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  // Next.js clamps request bodies passing through middleware/proxy to 10 MB by
  // default. Audio uploads (/api/upload, up to MAX_FILE_SIZE = 500 MB) flow
  // through the global middleware matcher, so raise the cap to match.
  experimental: {
    proxyClientMaxBodySize: '500mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=()' },
        ],
      },
    ];
  },
}

module.exports = nextConfig
