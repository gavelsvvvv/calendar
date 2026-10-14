import type { NextConfig } from "next";

/**
 * Content-Security-Policy, kept to what the app actually loads.
 *
 * `'unsafe-inline'` is present for scripts and it is not decoration: the app
 * ships three inline scripts it cannot do without — the timezone-cookie writer
 * in the document head, next-themes' pre-paint class setter, and the gtag
 * bootstrap that `@next/third-parties` injects — and Next does not currently
 * thread a nonce through them. The policy still earns its place: it pins script
 * *hosts* to this origin plus Google's tag server, pins where the page may talk
 * to, and forbids framing outright.
 *
 * `frame-ancestors 'none'` is the one that matters most here. A site with no
 * framing protection can be embedded inside an attacker's page and wrapped in
 * their chrome, which is a social-engineering vector in its own right — and
 * this site had no protection at all.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
  "img-src 'self' data: blob: https://polymarket-upload.s3.us-east-2.amazonaws.com https://www.google-analytics.com https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Belt and braces with frame-ancestors, for clients that predate CSP 2.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // `x-powered-by: Next.js` told every visitor the stack for no benefit.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    // Every market image Polymarket serves comes from this single bucket
    // (verified across a 1,200-event sample). Scoping the pattern to it keeps
    // the optimizer from doubling as an open image proxy.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "polymarket-upload.s3.us-east-2.amazonaws.com",
        pathname: "/**",
      },
    ],
    // Market icons never render larger than 48px, so there is no point
    // generating the default desktop-sized variants.
    imageSizes: [16, 20, 24, 32, 40, 48, 64, 96],
    minimumCacheTTL: 86_400,
  },
};

export default nextConfig;
