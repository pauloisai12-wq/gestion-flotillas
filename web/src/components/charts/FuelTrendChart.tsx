'use client';

import { useMemo } from 'react';
import EChartWrapper from './EChartWrapper';
import { useFuelTrend, DashboardFilters } from '@/hooks/useDashboardAnalytics';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { TrendingUp } from 'lucide-react';
import { tokens } from '@/lib/css-tokens';
import { formatCurrency, formatNumber } from '@/lib/formatters';

interface TrendItem {
  month: string;
  totalSpent: number;
  totalLiters: number;
}

interface TooltipParam {
  name: string;
  marker: string;
  seriesName: string;
  value: number;
}

export default function FuelTrendChart({ filters = {} }: { filters?: DashboardFilters }) {
  const { data, isLoading } = useFuelTrend(filters);

  const option = useMemo(() => {
    if (!data || data.length === 0) return null;

    const months = data.map((d: TrendItem) => d.month);
    const spent = data.map((d: TrendItem) => d.totalSpent);
    const liters = data.map((d: TrendItem) => d.totalLiters);

    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: TooltipParam[]) => {
          const month = params[0].name;
          let text = '<b>' + month + '</b>';
          for (const p of params) {
            const value = p.seriesName === 'Gasto ($)'
              ? formatCurrency(p.value, { minimumFractionDigits: 2 })
              : formatNumber(p.value) + ' L';
            text += '<br/>' + p.marker + ' ' + p.seriesName + ': ' + value;
          }
          return text;
        },
      },
      legend: { data: ['Gasto ($)', 'Litros'], bottom: 0 },
      grid: { top: 20, right: 60, bottom: 40, left: 70 },
      xAxis: { type: 'category' as const, data: months },
      yAxis: [
        {
          type: 'value' as const,
          name: 'Gasto ($)',
          axisLabel: { formatter: (v: number) => '$' + (v / 1000).toFixed(0) + 'k' },
        },
        {
          type: 'value' as const,
          name: 'Litros',
          axisLabel: { formatter: (v: number) => formatNumber(v) + ' L' },
        },
      ],
      series: [
        {
          name: 'Gasto ($)', type: 'line' as const, data: spent, smooth: false,
          areaStyle: { opacity: 0.12 }, itemStyle: { color: tokens.chart1() },
          lineStyle: { width: 2, color: tokens.chart1() },
        },
        {
          name: 'Litros', type: 'line' as const, yAxisIndex: 1, data: liters,
          smooth: false, itemStyle: { color: tokens.chart3() },
          lineStyle: { width: 2, color: tokens.chart3() },
        },
      ],
    };
  }, [data]);

  if (isLoading) return <SkeletonChart />;
  if (!data || data.length === 0 || !option) {
    return (
      <Card>
        <CardHeader><CardTitle>Tendencia de gasto mensual</CardTitle></CardHeader>
        <CardContent>
          <EmptyState icon={TrendingUp} title="Sin registros" description="Aún no hay datos de combustible para graficar." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Tendencia de gasto mensual</CardTitle></CardHeader>
      <CardContent>
        <EChartWrapper option={option} />
      </CardContent>
    </Card>
  );
}
