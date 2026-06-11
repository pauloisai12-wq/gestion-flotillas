// Greeting + timestamp + refresh — header compartido entre dashboards

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/formatters';

function getGreeting(hour: number): string {
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function formatRelative(date: Date | null, now: number): string {
  if (!date) return '';
  const seconds = Math.floor((now - date.getTime()) / 1000);
  if (seconds < 10) return 'recién';
  if (seconds < 60) return `hace ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return formatDateTime(date, { hour: '2-digit', minute: '2-digit' });
}

export interface DashboardGreetingProps {
  title: string;
  description: string;
  updatedAt?: number | Date | null;
  onRefresh?: () => void;
}

export function DashboardGreeting({ title, description, updatedAt, onRefresh }: DashboardGreetingProps) {
  const { user } = useAuth();
  const firstName = user?.fullName?.split(' ')[0] ?? '';
  const date = updatedAt ? (updatedAt instanceof Date ? updatedAt : new Date(updatedAt)) : null;

  // SSR usa hora/timestamp del server; el cliente del browser. Para evitar
  // hydration mismatch, renderizamos placeholders neutros hasta que el
  // efecto corra en el cliente, y luego refrescamos el "hace N min" cada 30s.
  const [clock, setClock] = useState<{ hour: number; now: number } | null>(null);
  useEffect(() => {
    const tick = () => setClock({ hour: new Date().getHours(), now: Date.now() });
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between border-b border-border/60 pb-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {clock ? getGreeting(clock.hour) : 'Hola'}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{title} · {description}</p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-success animate-pulse" />
        <span>Actualizado {clock ? formatRelative(date, clock.now) : '…'}</span>
        {onRefresh && (
          <Button variant="ghost" size="icon-xs" onClick={onRefresh} aria-label="Refrescar">
            <RefreshCw className="size-3" />
          </Button>
        )}
      </div>
    </header>
  );
}
