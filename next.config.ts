import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    const production = process.env.NODE_ENV === 'production';
    // Next's static pages include inline bootstrap scripts. A nonce policy would
    // require dynamic rendering; this policy keeps the static portfolio shell.
    const policy = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${production ? '' : ' ws: wss:'}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          {key: 'Content-Security-Policy', value: policy},
          {key: 'X-Content-Type-Options', value: 'nosniff'},
          {key: 'X-Frame-Options', value: 'DENY'},
          {key: 'Referrer-Policy', value: 'no-referrer'},
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          ...(production
            ? [{key: 'Strict-Transport-Security', value: 'max-age=31536000'}]
            : []),
        ],
      },
    ];
  },
  // The live commerce endpoints explicitly opt out of static rendering.
};

export default nextConfig;
