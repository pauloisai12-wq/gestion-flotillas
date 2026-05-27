import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="size-16 rounded-full bg-primary-subtle flex items-center justify-center">
            <Compass className="size-8 text-primary" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="font-mono text-6xl font-semibold tracking-tight text-foreground">404</h1>
          <h2 className="text-xl font-medium text-foreground">Página no encontrada</h2>
          <p className="text-sm text-muted-foreground">
            La ruta que buscas no existe o se movió. Verifica el URL o vuelve al inicio.
          </p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Ir al dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            Login
          </Link>
        </div>
      </div>
    </div>
  );
}
