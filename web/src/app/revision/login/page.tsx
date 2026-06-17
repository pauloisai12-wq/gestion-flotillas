'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export default function RevisionLoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password, '/revision');
    } catch (err: unknown) {
      const { status, data, code } = getApiError(err);
      const backendMessage = data?.message ?? data?.error;

      // Mapeo explícito por status — evita mostrar el mismo "credenciales
      // inválidas" cuando el problema real es rate-limit u otra cosa.
      if (status === 429) {
        const retry = data?.retryAfter;
        setError(
          retry
            ? `Demasiados intentos. Espera ${retry} segundos antes de reintentar.`
            : 'Demasiados intentos. Espera ~1 minuto antes de reintentar.',
        );
      } else if (status === 401) {
        setError('Credenciales inválidas. Verifica correo y contraseña.');
      } else if (status === 403) {
        setError(backendMessage || 'Cuenta bloqueada. Contacta al administrador.');
      } else if (!status || code === 'ERR_NETWORK') {
        setError('No se pudo contactar al servidor. Revisa tu conexión.');
      } else {
        setError(backendMessage || `Error al iniciar sesión (HTTP ${status})`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 relative overflow-hidden">
      {/* Glow rosa de marca */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            'radial-gradient(600px circle at 50% 120%, var(--primary-subtle), transparent 60%)',
        }}
      />

      <Card className="relative w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--primary-subtle)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Portal de revisión</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Revisión de evidencias</h1>
          <p className="text-sm text-muted-foreground mt-1">Consulta y descarga la evidencia capturada en campo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2.5 text-sm">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Correo electrónico
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="revisor@flotillas.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Contraseña
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" disabled={loading || !email || !password} className="w-full" size="lg">
            {loading ? 'Iniciando sesión…' : 'Iniciar sesión'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
