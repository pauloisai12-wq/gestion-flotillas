// Footer institucional — versión, link a privacidad, copyright

import Link from 'next/link';

const VERSION = '2.1.0'; // bump al deployar
const BUILD_DATE = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="border-t border-border/60 bg-card/40 mt-auto">
      <div className="mx-auto max-w-[1600px] px-4 xl:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          <span>Flotillas · Sala de control</span>
          <span className="text-border">·</span>
          <span className="font-mono">v{VERSION}</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/legal/privacidad" className="hover:text-foreground transition-colors">
            Aviso de privacidad
          </Link>
          <Link href="/legal/terminos" className="hover:text-foreground transition-colors">
            Términos
          </Link>
          <span>© {BUILD_DATE}</span>
        </div>
      </div>
    </footer>
  );
}
