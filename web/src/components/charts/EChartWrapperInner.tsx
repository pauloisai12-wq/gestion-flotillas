// Wrapper de ECharts — inicializa UNA vez, usa setOption para updates.
// Solo dispone cuando cambia el tema (light/dark).
//
// OPTIMIZACIÓN: importa solo los chart types y componentes que usamos.
// Esto reduce el bundle de ~1.1 MB a ~250 KB (-77%). Crítico para ngrok.
// Si en el futuro se usan más tipos (pie, scatter, etc.), agregarlos aquí.

'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, BarChart, GaugeChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { buildEchartsTheme } from '@/lib/echarts-theme';
import { useTheme } from '@/components/theme-provider';

// Registro de módulos (ejecuta una vez por proceso)
echarts.use([
  LineChart,
  BarChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);

interface EChartWrapperProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: any;
  height?: string;
  className?: string;
  /** Callback con la instancia de ECharts para escuchar eventos custom */
  onReady?: (instance: echarts.ECharts) => void;
}

export default function EChartWrapper({
  option, height = '320px', className = '', onReady,
}: EChartWrapperProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const onReadyRef = useRef(onReady);
  const { resolvedTheme } = useTheme();

  // Mantener ref actualizado sin disparar re-init
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);

  // Init una vez + re-init al cambiar tema
  useEffect(() => {
    if (!chartRef.current) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current);
      const theme = buildEchartsTheme();
      instanceRef.current.setOption({ ...theme, ...option }, true);
      onReadyRef.current?.(instanceRef.current);
    }

    return () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  // Updates de option (merge, sin dispose)
  useEffect(() => {
    if (!instanceRef.current) return;
    instanceRef.current.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  // Resize
  useEffect(() => {
    function handleResize() { instanceRef.current?.resize(); }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div ref={chartRef} style={{ height }} className={className} />;
}
