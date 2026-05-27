// Tema unificado de ECharts — lee tokens CSS en runtime para coherencia con design system
// Se re-aplica al cambiar entre light/dark mode.

function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function buildEchartsTheme() {
  const tokens = {
    foreground: cssVar("--foreground"),
    mutedForeground: cssVar("--muted-foreground"),
    border: cssVar("--border"),
    card: cssVar("--card"),
    popover: cssVar("--popover"),
    primary: cssVar("--primary"),
    chart1: cssVar("--chart-1"),
    chart2: cssVar("--chart-2"),
    chart3: cssVar("--chart-3"),
    chart4: cssVar("--chart-4"),
    chart5: cssVar("--chart-5"),
    chart6: cssVar("--chart-6"),
    chart7: cssVar("--chart-7"),
    chart8: cssVar("--chart-8"),
  };

  const palette = [
    tokens.chart1,
    tokens.chart2,
    tokens.chart3,
    tokens.chart4,
    tokens.chart5,
    tokens.chart6,
    tokens.chart7,
    tokens.chart8,
  ];

  return {
    color: palette,
    backgroundColor: "transparent",
    textStyle: {
      fontFamily:
        'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: tokens.foreground,
      fontFeatureSettings: "'tnum'",
    },
    title: {
      textStyle: {
        color: tokens.foreground,
        fontWeight: 600,
        fontSize: 14,
      },
      subtextStyle: {
        color: tokens.mutedForeground,
        fontSize: 12,
      },
    },
    legend: {
      textStyle: {
        color: tokens.mutedForeground,
        fontSize: 12,
      },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      bottom: 0,
    },
    tooltip: {
      backgroundColor: tokens.popover,
      borderColor: tokens.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: {
        color: tokens.foreground,
        fontSize: 12,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
      axisPointer: {
        type: "line",
        lineStyle: {
          color: tokens.border,
          width: 1,
          type: "solid",
          opacity: 0.6,
        },
        crossStyle: {
          color: tokens.border,
          opacity: 0.4,
        },
      },
      extraCssText: `border-radius: 8px; box-shadow: 0 4px 16px -2px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02); backdrop-filter: blur(8px);`,
    },
    grid: {
      left: "1%",
      right: "1%",
      top: 16,
      bottom: 36,
      containLabel: true,
    },
    categoryAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.mutedForeground,
        fontSize: 11,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        margin: 12,
      },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.mutedForeground,
        fontSize: 11,
        fontFamily:
          "'JetBrains Mono', ui-monospace, monospace",
        margin: 8,
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: tokens.border,
          type: "dashed",
          opacity: 0.35,
          width: 1,
        },
      },
    },
    line: {
      itemStyle: { borderWidth: 2 },
      lineStyle: { width: 2 },
      symbolSize: 6,
      symbol: "circle",
      smooth: 0.2,
      showSymbol: true,
      emphasis: {
        scale: 1.3,
        lineStyle: { width: 2.5 },
      },
    },
    bar: {
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      emphasis: { itemStyle: { opacity: 1 } },
    },
    pie: {
      itemStyle: { borderColor: tokens.card, borderWidth: 2 },
      label: { color: tokens.foreground, fontSize: 12 },
      // NO definir emphasis aquí — cada chart pie lo configura individualmente
      // para evitar conflictos con focus/blur/scale
    },
    gauge: {
      axisLine: {
        lineStyle: { color: [[1, tokens.border]], width: 14 },
      },
      progress: { show: true, width: 14 },
      pointer: { show: false },
      title: { color: tokens.mutedForeground, fontSize: 12 },
      detail: {
        color: tokens.foreground,
        fontSize: 22,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontWeight: 600,
      },
    },
  } as const;
}
