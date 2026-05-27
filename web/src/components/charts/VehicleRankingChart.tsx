'use client';

import { useState, useMemo } from 'react';
import EChartWrapper from './EChartWrapper';
import { useVehicleRankingTop, useVehicleRankingBottom, DashboardFilters } from '@/hooks/useDashboardAnalytics';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Truck } from 'lucide-react';
import { tokens } from '@/lib/css-tokens';

interface RankingItem {
  eco: string;
  avgKml: number;
  expectedKml: number;
  vehicleType: string;
}

export default function VehicleRankingChart({ filters = {} }: { filters?: DashboardFilters }) {
  const [view, setView] = useState<'top' | 'bottom'>('top');
  const { data: topData, isLoading: loadingTop } = useVehicleRankingTop(10, filters);
  const { data: bottomData, isLoading: loadingBottom } = useVehicleRankingBottom(10, filters);

  const isLoading = view === 'top' ? loadingTop : loadingBottom;
  const data = view === 'top' ? topData : bottomData;

  // ⚠ Todos los hooks ANTES de cualquier return condicional
  const option = useMemo(() => {
    if (!data || data.length === 0) return null;
    const reversed = [...data].reverse();
    const labels = reversed.map((d: RankingItem) => d.eco);
    const values = reversed.map((d: RankingItem) => d.avgKml);
    const expected = reversed.length > 0 ? reversed[0].expectedKml : 0;
    const success = tokens.success();
    const warning = tokens.warning();
    const destructive = tokens.destructive();
    const muted = tokens.mutedForeground();

    return {
      tooltip: {
        trigger: 'axis' as const,
        formatter: (params: { name: string; value: number }[]) => {
          const item = reversed.find((d: RankingItem) => d.eco === params[0].name);
          if (!item) return '';
          return '<b>' + item.eco + '</b> (' + item.vehicleType + ')<br/>'
            + 'Rendimiento: ' + item.avgKml + ' km/l<br/>'
            + 'Esperado: ' + item.expectedKml + ' km/l';
        },
      },
      grid: { top: 30, right: 30, bottom: 30, left: 90 },
      xAxis: { type: 'value' as const, name: 'km/l' },
      yAxis: { type: 'category' as const, data: labels, axisLabel: { fontSize: 11 } },
      series: [{
        type: 'bar' as const,
        data: values.map((v: number) => ({
          value: v,
          itemStyle: {
            color: v >= expected ? success : v >= expected * 0.8 ? warning : destructive,
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: '60%',
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: muted, type: 'dashed' as const, opacity: 0.6 },
          data: [{
            xAxis: expected,
            label: {
              formatter: 'Esperado: ' + expected + ' km/l',
              color: muted,
              position: 'end' as const,
              distance: 6,
              fontSize: 10,
            },
          }],
        },
      }],
    };
  }, [data]);

  const header = (
    <div className="flex items-center justify-between gap-4">
      <CardTitle>Ranking rendimiento (km/l)</CardTitle>
      <div className="flex gap-1">
        <Button size="xs" variant={view === 'top' ? 'default' : 'outline'} onClick={() => setView('top')}>
          Top 10
        </Button>
        <Button size="xs" variant={view === 'bottom' ? 'destructive' : 'outline'} onClick={() => setView('bottom')}>
          Bottom 10
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>{header}</CardHeader>
        <CardContent><SkeletonChart /></CardContent>
      </Card>
    );
  }

  if (!option) {
    return (
      <Card>
        <CardHeader>{header}</CardHeader>
        <CardContent>
          <EmptyState icon={Truck} title="Sin datos de ranking" description="Registra cargas de combustible para ver el ranking." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>{header}</CardHeader>
      <CardContent>
        <EChartWrapper option={option} height="400px" />
      </CardContent>
    </Card>
  );
}
