import * as React from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";

type Trend = "up" | "down" | "flat";

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  /** Unidad opcional renderizada en menor jerarquía visual (ej. "km", "MXN", "L") */
  unit?: string;
  hint?: string;
  delta?: { value: string; trend: Trend; meaning?: "good" | "bad" };
  icon?: React.ComponentType<{ className?: string }>;
  /** Datos para microsparkline */
  spark?: number[];
  /** Si se pasa, la card se vuelve clickeable y muestra chevron en hover */
  href?: string;
  className?: string;
}

export function KpiCard({
  label,
  value,
  unit,
  hint,
  delta,
  icon: Icon,
  spark,
  href,
  className,
}: KpiCardProps) {
  const sparkColor =
    delta?.meaning === "bad"
      ? "var(--destructive)"
      : delta?.meaning === "good"
        ? "var(--success)"
        : "var(--primary)";

  const content = (
    <Card
      className={cn(
        "group/kpi p-5 relative",
        href && "cursor-pointer hover:ring-border hover:shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground truncate">
              {value}
            </span>
            {unit && (
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                {unit}
              </span>
            )}
          </div>
          {hint && (
            <span className="text-xs text-muted-foreground truncate">{hint}</span>
          )}
        </div>
        {Icon && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary">
            <Icon className="size-4" />
          </div>
        )}
      </div>

      {(delta || spark) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          {delta ? <DeltaRow delta={delta} /> : <span />}
          {spark && spark.length > 1 && (
            <Sparkline data={spark} stroke={sparkColor} fill={sparkColor} width={88} height={28} />
          )}
        </div>
      )}

      {href && (
        <ChevronRight
          className="absolute bottom-3 right-3 size-3.5 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/kpi:opacity-100"
          aria-hidden
        />
      )}
    </Card>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

function DeltaRow({ delta }: { delta: NonNullable<KpiCardProps["delta"]> }) {
  const meaning =
    delta.meaning ?? (delta.trend === "down" ? "bad" : delta.trend === "up" ? "good" : undefined);
  const TrendIcon = delta.trend === "up" ? TrendingUp : delta.trend === "down" ? TrendingDown : Minus;
  const colorClass =
    meaning === "good"
      ? "text-success"
      : meaning === "bad"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-1 text-xs font-medium", colorClass)}>
      <TrendIcon className="size-3" />
      <span className="font-mono tabular-nums">{delta.value}</span>
    </div>
  );
}
