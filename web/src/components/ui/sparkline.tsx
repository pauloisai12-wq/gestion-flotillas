// Sparkline minimalista en SVG puro — sin deps de ECharts para mantener bundle ligero
// y permitir cientos de instancias sin overhead.

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
  showArea?: boolean;
}

export function Sparkline({
  data,
  width = 80,
  height = 28,
  stroke,
  fill,
  className,
  showArea = true,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });

  const pathLine = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const pathArea = `${pathLine} L ${width.toFixed(2)} ${height} L 0 ${height} Z`;

  const lineColor = stroke ?? "var(--primary)";
  const areaColor = fill ?? "var(--primary)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("inline-block overflow-visible", className)}
      aria-hidden="true"
    >
      {showArea && (
        <path d={pathArea} fill={areaColor} fillOpacity={0.12} stroke="none" />
      )}
      <path
        d={pathLine}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
