'use client';

import EChartWrapper from './EChartWrapper';
import { useBudgetProgress, DashboardFilters } from '@/hooks/useDashboardAnalytics';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SkeletonChart } from '@/components/ui/skeleton';
import { tokens } from '@/lib/css-tokens';

export default function BudgetGauge({ filters = {} }: { filters?: DashboardFilters }) {
  const { data, isLoading } = useBudgetProgress(filters);

  if (isLoading) return <SkeletonChart />;

  let totalAssigned = 0;
  let totalSpent = 0;
  if (data && data.length > 0) {
    for (const item of data) {
      totalAssigned += item.assigned;
      totalSpent += item.spent;
    }
  }

  const pct = totalAssigned > 0 ? Math.round((totalSpent / totalAssigned) * 1000) / 10 : 0;
  const success = tokens.success();
  const warning = tokens.warning();
  const destructive = tokens.destructive();
  const textColor = pct < 70 ? success : pct < 90 ? warning : destructive;

  const option = {
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
      pointer: { show: true, length: '60%', width: 4 },
      axisLine: { lineStyle: { width: 16, color: [[0.7, success], [0.9, warning], [1, destructive]] } },
      axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { distance: 26, fontSize: 11, color: tokens.mutedForeground(), formatter: function (v: number) { return v + '%'; } },
      detail: {
        valueAnimation: true,
        formatter: function (v: number) { return v.toFixed(1) + '%'; },
        fontSize: 28, fontWeight: 600, color: textColor, offsetCenter: [0, '70%'],
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      },
      data: [{ value: pct }],
    }],
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Presupuesto del mes</CardTitle>
      </CardHeader>
      <CardContent>
        <EChartWrapper option={option} height="280px" />
        <p className="text-center text-xs text-muted-foreground font-mono tabular-nums">
          ${totalSpent.toLocaleString('es-MX', { minimumFractionDigits: 2 })} de ${totalAssigned.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
        </p>
      </CardContent>
    </Card>
  );
}
