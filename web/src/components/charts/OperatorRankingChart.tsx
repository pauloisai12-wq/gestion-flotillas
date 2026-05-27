'use client';

import EChartWrapper from './EChartWrapper';
import { useOperatorRanking, DashboardFilters } from '@/hooks/useDashboardAnalytics';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { User } from 'lucide-react';
import { tokens } from '@/lib/css-tokens';

interface OperatorItem {
  operatorName: string;
  avgKml: number;
  loadCount: number;
  totalSpent: number;
}

export default function OperatorRankingChart({ filters = {} }: { filters?: DashboardFilters }) {
  const { data, isLoading } = useOperatorRanking(10, filters);

  if (isLoading) return <SkeletonChart />;
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Ranking de operadores (km/l)</CardTitle></CardHeader>
        <CardContent>
          <EmptyState icon={User} title="Sin operadores" description="No hay datos de rendimiento por operador." />
        </CardContent>
      </Card>
    );
  }

  const reversed = [...data].reverse();
  const names = reversed.map((d: OperatorItem) => d.operatorName);
  const values = reversed.map((d: OperatorItem) => d.avgKml);
  const primary = tokens.chart1();

  const option = {
    tooltip: {
      trigger: 'axis' as const,
      formatter: function (params: { name: string; value: number }[]) {
        const item = reversed.find((d: OperatorItem) => d.operatorName === params[0].name);
        if (!item) return '';
        return '<b>' + item.operatorName + '</b><br/>'
          + 'Rendimiento: ' + item.avgKml + ' km/l<br/>'
          + 'Cargas: ' + item.loadCount + '<br/>'
          + 'Gasto: $' + Number(item.totalSpent).toLocaleString('es-MX', { minimumFractionDigits: 2 });
      },
    },
    grid: { top: 10, right: 30, bottom: 30, left: 120 },
    xAxis: { type: 'value' as const, name: 'km/l' },
    yAxis: { type: 'category' as const, data: names, axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar' as const, data: values, barWidth: '60%',
      itemStyle: {
        color: primary,
        opacity: 0.9,
        borderRadius: [0, 4, 4, 0],
      },
    }],
  };

  return (
    <Card>
      <CardHeader><CardTitle>Ranking de operadores (km/l)</CardTitle></CardHeader>
      <CardContent>
        <EChartWrapper option={option} height="400px" />
      </CardContent>
    </Card>
  );
}
