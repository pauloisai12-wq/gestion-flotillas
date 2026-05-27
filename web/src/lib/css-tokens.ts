// Helper para leer design tokens CSS en runtime.
// Usado por ECharts, que no puede consumir CSS variables directamente.

export function cssVar(name: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

// Getters tipados para tokens semánticos usados en gráficas
export const tokens = {
  foreground: () => cssVar("--foreground"),
  mutedForeground: () => cssVar("--muted-foreground"),
  border: () => cssVar("--border"),
  card: () => cssVar("--card"),
  popover: () => cssVar("--popover"),
  primary: () => cssVar("--primary"),
  success: () => cssVar("--success"),
  destructive: () => cssVar("--destructive"),
  warning: () => cssVar("--warning"),
  maintenance: () => cssVar("--maintenance"),
  info: () => cssVar("--info"),
  chart1: () => cssVar("--chart-1"),
  chart2: () => cssVar("--chart-2"),
  chart3: () => cssVar("--chart-3"),
  chart4: () => cssVar("--chart-4"),
  chart5: () => cssVar("--chart-5"),
  chart6: () => cssVar("--chart-6"),
  chart7: () => cssVar("--chart-7"),
  chart8: () => cssVar("--chart-8"),
};
