'use client';

// Widget de Cloudflare Turnstile (render explícito, sin dependencias npm).
// Carga el script oficial una sola vez y monta el captcha; entrega el token al
// padre vía onToken. Para forzar un token nuevo (tras un submit consumido o
// fallido), el padre remonta el componente cambiando su `key`.

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

// Promesa singleton: todos los montajes comparten la misma carga del script,
// sin acumular listeners sobre el <script> en remontajes rápidos.
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined' || window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        // Deja reintentar en el siguiente montaje si la carga falló.
        scriptPromise = null;
        s.remove();
        reject(new Error('No se pudo cargar Turnstile'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export default function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
          theme: 'auto',
        });
      })
      .catch(() => {
        // Si el script no carga, el token queda vacío y el backend rechazará
        // el submit en producción (fail-closed). No bloqueamos el render.
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* el widget ya pudo haberse desmontado */
        }
        widgetIdRef.current = null;
      }
    };
    // siteKey y onToken (setState) son estables; el widget se monta una vez.
    // Para refrescar el token, el padre remonta vía `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="flex justify-center" />;
}
