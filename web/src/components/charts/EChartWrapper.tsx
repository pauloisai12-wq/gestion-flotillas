// Wrapper PÚBLICO de ECharts con carga lazy.
//
// La librería pesa ~600 KB (incluso con tree-shaking). Sobre ngrok eso son
// 6-15 segundos de espera. Con dynamic import, ECharts solo se descarga
// cuando un gráfico se renderiza por primera vez — es decir, cuando el
// usuario abre el dashboard, no en /login ni en otras páginas sin gráficos.
//
// ssr: false porque ECharts depende del DOM (no se puede server-render).
//
// Los consumidores siguen importando desde el mismo path sin cambios.

'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const EChartWrapper = dynamic(() => import('./EChartWrapperInner'), {
  ssr: false,
  loading: () => <Skeleton className="w-full h-[320px]" />,
});

export default EChartWrapper;
