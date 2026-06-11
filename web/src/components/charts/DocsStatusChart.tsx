// Donut SVG puro — sin ECharts (que tenía bugs de blur/emphasis irresolubles)
// Highlight: el segmento hover gana stroke-width + opacity full; los otros NO se atenúan

'use client';

import { useMemo, useState } from 'react';
import { useDashboardSummary } from '@/hooks/useDashboard';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SkeletonChart } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { FileText } from 'lucide-react';
import { tokens } from '@/lib/css-tokens';
import { formatNumber } from '@/lib/formatters';

interface Segment {
  name: string;
  value: number;
  color: string;
}

/** Genera el atributo `d` de un arco SVG */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const startO = polarToCartesian(cx, cy, rOuter, endAngle);
  const endO = polarToCartesian(cx, cy, rOuter, startAngle);
  const startI = polarToCartesian(cx, cy, rInner, endAngle);
  const endI = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    `M ${startO.x} ${startO.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endO.x} ${endO.y}`,
    `L ${endI.x} ${endI.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${startI.x} ${startI.y}`,
    'Z',
  ].join(' ');
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export default function DocsStatusChart() {
  const { data, isLoading } = useDashboardSummary();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  const segments: Segment[] = useMemo(() => {
    if (!data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = data as any;
    return [
      { name: 'Vigentes', value: Number(d.docsValid ?? 0), color: tokens.success() },
      { name: 'Por vencer', value: Number(d.docsExpiring ?? 0), color: tokens.warning() },
      { name: 'Vencidos', value: Number(d.docsExpired ?? 0), color: tokens.destructive() },
    ];
  }, [data]);

  const visibleSegments = segments.filter((s) => !hiddenSeries.has(s.name));
  const visibleTotal = visibleSegments.reduce((acc, s) => acc + s.value, 0);
  const totalAll = segments.reduce((acc, s) => acc + s.value, 0);

  if (isLoading) return <SkeletonChart />;
  if (!data) {
    return (
      <Card>
        <CardHeader><CardTitle>Estado de documentos</CardTitle></CardHeader>
        <CardContent>
          <EmptyState icon={FileText} title="Sin datos" description="No hay información de documentos." />
        </CardContent>
      </Card>
    );
  }
  if (totalAll === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Estado de documentos</CardTitle></CardHeader>
        <CardContent>
          <EmptyState
            icon={FileText}
            title="Aún no hay documentos cargados"
            description={`Hay ${data.totalVehicles ?? 0} vehículos registrados pero ninguno tiene documentos (factura, seguro, verificación, tarjeta de circulación). Súbelos desde el detalle de cada vehículo.`}
          />
        </CardContent>
      </Card>
    );
  }

  // Geometría del donut
  const SIZE = 280;
  const cx = SIZE / 2;
  const cy = SIZE / 2 - 18; // ligero offset arriba para la leyenda
  const R_OUTER = 95;
  const R_INNER = 65;

  // Calcular ángulos de cada segmento visible
  let currentAngle = 0;
  const arcs = visibleSegments.map((seg) => {
    const sweep = visibleTotal > 0 ? (seg.value / visibleTotal) * 360 : 0;
    const start = currentAngle;
    const end = currentAngle + sweep;
    currentAngle = end;
    const realIdx = segments.findIndex((x) => x.name === seg.name);
    return { ...seg, start, end, realIdx };
  });

  function toggleSegment(name: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      // No permitir ocultar TODOS
      if (next.size >= segments.length) return prev;
      return next;
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Estado de documentos</CardTitle></CardHeader>
      <CardContent>
        <div className="relative">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="w-full h-[280px]"
            role="img"
            aria-label="Distribución de estado de documentos"
          >
            {arcs.map((arc) => {
              if (arc.start === arc.end) return null;
              const isHovered = hoverIdx === arc.realIdx;
              const isOtherHovered = hoverIdx !== null && hoverIdx !== arc.realIdx;
              // Si TODA la rueda es un solo segmento (100%), render circle
              if (arc.end - arc.start >= 359.99) {
                return (
                  <g key={arc.name}>
                    <circle
                      cx={cx} cy={cy} r={R_OUTER}
                      fill={arc.color}
                      onMouseEnter={() => setHoverIdx(arc.realIdx)}
                      onMouseLeave={() => setHoverIdx(null)}
                      style={{
                        cursor: 'pointer',
                        filter: isHovered ? 'drop-shadow(0 0 12px rgba(0,0,0,0.3))' : 'none',
                        transition: 'filter 150ms ease',
                      }}
                    />
                    <circle cx={cx} cy={cy} r={R_INNER} fill="var(--card)" />
                  </g>
                );
              }
              return (
                <path
                  key={arc.name}
                  d={arcPath(cx, cy, R_OUTER, R_INNER, arc.start, arc.end)}
                  fill={arc.color}
                  stroke="var(--card)"
                  strokeWidth={2}
                  onMouseEnter={() => setHoverIdx(arc.realIdx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{
                    cursor: 'pointer',
                    // Los OTROS segmentos quedan 100% opacos — sin atenuación
                    opacity: 1,
                    filter: isHovered ? 'drop-shadow(0 0 8px rgba(0,0,0,0.35))' : 'none',
                    transition: 'filter 150ms ease',
                  }}
                >
                  <title>{`${arc.name}: ${formatNumber(arc.value)} (${visibleTotal > 0 ? ((arc.value / visibleTotal) * 100).toFixed(1) : 0}%)`}</title>
                </path>
              );
              // Suprimir warning de variable no usada
              void isOtherHovered;
            })}
          </svg>

          {/* Número central */}
          <div className="pointer-events-none absolute inset-x-0 top-[42%] -translate-y-1/2 flex flex-col items-center">
            <span className="font-mono text-3xl font-semibold tabular-nums text-foreground leading-none">
              {formatNumber(hoverIdx !== null ? segments[hoverIdx].value : visibleTotal)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1.5">
              {hoverIdx !== null ? segments[hoverIdx].name : 'Documentos'}
            </span>
          </div>
        </div>

        {/* Leyenda clickeable */}
        <div className="flex items-center justify-center gap-4 mt-2 text-xs">
          {segments.map((seg) => {
            const isHidden = hiddenSeries.has(seg.name);
            return (
              <button
                key={seg.name}
                type="button"
                onClick={() => toggleSegment(seg.name)}
                className="flex items-center gap-1.5 hover:opacity-100 transition-opacity"
                style={{ opacity: isHidden ? 0.4 : 1 }}
                aria-pressed={!isHidden}
              >
                <span
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: seg.color, textDecoration: isHidden ? 'line-through' : 'none' }}
                />
                <span style={{ textDecoration: isHidden ? 'line-through' : 'none' }}>{seg.name}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
