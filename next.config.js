/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  // Keep native / dynamic-require packages out of the server bundle. API
  // routes already auto-externalize these; declaring them here also covers
  // the instrumentation.js bundle, which transitively imports lib/ai-service
  // (fluent-ffmpeg + @ffmpeg-installer do a runtime require the tracer can't
  // resolve). They stay as plain node_modules requires at runtime.
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', 'fluent-ffmpeg'],
  outputFileTracingIncludes: {
    '/api/translate/file': [
      './node_modules/@fontsource/noto-sans/LICENSE',
      './node_modules/@fontsource/noto-sans/unicode.json',
      './node_modules/@fontsource/noto-sans/files/*.woff',
      './node_modules/@fontsource/noto-sans-arabic/LICENSE',
      './node_modules/@fontsource/noto-sans-arabic/unicode.json',
      './node_modules/@fontsource/noto-sans-arabic/files/*-400-normal.woff',
      './node_modules/@fontsource/noto-sans-sc/LICENSE',
      './node_modules/@fontsource/noto-sans-sc/unicode.json',
      './node_modules/@fontsource/noto-sans-sc/files/*-400-normal.woff',
      './node_modules/@fontsource/noto-sans-tc/LICENSE',
      './node_modules/@fontsource/noto-sans-tc/unicode.json',
      './node_modules/@fontsource/noto-sans-tc/files/*-400-normal.woff',
    ],
  },
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
