import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withBundleAnalyzer from "@next/bundle-analyzer";

const API_TARGET = process.env.API_PROXY_TARGET || "http://localhost:3001";

// El build real de Docker hornea API_PROXY_TARGET (ARG → http://api:3001). Si no
// está en un build de producción (p.ej. el check de CI o un `npm run build` local),
// avisamos pero NO rompemos: el fallback a localhost solo afecta a builds que no se
// despliegan; el rewrite solo importa en runtime.
if (process.env.NODE_ENV === "production" && !process.env.API_PROXY_TARGET) {
  console.warn(
    "[next.config] API_PROXY_TARGET no definido; usando fallback http://localhost:3001 " +
      "(el build de Docker lo inyecta vía ARG).",
  );
}

const nextConfig: NextConfig = {
  // Compresión gzip en respuestas SSR/HTML. Crítico para ngrok.
  compress: true,

  // Power-by header innecesario (info para atacantes, bytes extra)
  poweredByHeader: false,

  // Output standalone reduce ~80% el tamaño de la imagen Docker prod —
  // copia solo lo necesario en lugar de todo node_modules.
  output: "standalone",

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_TARGET}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${API_TARGET}/uploads/:path*`,
      },
    ];
  },

  // Cache largo y agresivo en assets estáticos optimizados por Next.
  // Next ya hashea estos archivos, así que son seguros de cachear "for ever".
  async headers() {
    // Cabeceras de seguridad para el HTML que sirve Next (Helmet solo cubre la
    // API en :3001, no las páginas en :3000). Cubre clickjacking, sniffing,
    // referrer y HSTS. NOTA: una CSP estricta del HTML se deja para un follow-up
    // con nonce — un script-src 'self' sin nonce rompe la hidratación de Next.
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ];
    return [
      {
        // Seguridad: aplica a todas las rutas (HTML y assets).
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Assets de Next.js (JS, CSS, fonts, imágenes optimizadas)
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Imágenes en /public
        source: "/:path*\\.(png|jpg|jpeg|gif|webp|avif|svg|ico)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Fuentes
        source: "/:path*\\.(woff|woff2|ttf|otf)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.ngrok.io",
    "*.ngrok-free.dev",
  ],
};

// Bundle analyzer: solo se activa cuando ANALYZE=true (sin overhead en builds normales).
//   ANALYZE=true npm run build
const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// withSentryConfig solo activa upload de sourcemaps si SENTRY_AUTH_TOKEN está
// definido — sin él Sentry funciona pero los stacktraces serán menos legibles.
export default withSentryConfig(bundleAnalyzer(nextConfig), {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  disableLogger: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
