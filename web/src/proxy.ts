// Proxy (anteriormente Middleware en Next.js ≤15) — chequeo optimista de sesión.
//
// Esto NO valida el JWT ni hace RBAC; solo redirige al login a quien no
// trae cookie de sesión, así no se sirve siquiera el HTML de las páginas
// protegidas. La validación real del token y el RBAC siguen ocurriendo en
// el backend (api/ — authMiddleware + roleMiddleware), que es la única
// fuente de verdad.
//
// Convención Next.js 16: el archivo se llama proxy.ts y la función exportada
// proxy (no middleware). Ref: node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md

import { NextResponse, type NextRequest } from 'next/server';

// Rutas que cualquiera puede visitar sin haber iniciado sesión.
const PUBLIC_PATHS = ['/login', '/cargas']; // /cargas/* es el portal del operador

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas pasan sin chequeo
  if (pathname === '/') return NextResponse.next();
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return NextResponse.next();
  }

  // Para todo lo demás exigimos al menos la cookie de sesión.
  const token = req.cookies.get('token')?.value;
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    // Conservar destino original para volver tras login (opcional).
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Excluimos assets, imágenes, _next y endpoints /api del backend (que pasan
// por el rewrite de next.config.ts y no necesitan gating de Next).
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.(?:png|svg|jpg|jpeg|gif|webp|ico)$).*)'],
};
