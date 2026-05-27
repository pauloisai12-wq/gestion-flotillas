import * as React from "react";
import { CheckCircle2, XCircle, AlertTriangle, Wrench, MinusCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusKind =
  | "operative"
  | "blocked"
  | "expiring"
  | "maintenance"
  | "inactive"
  | "info";

const statusMap: Record<
  StatusKind,
  { label: string; Icon: React.ComponentType<{ className?: string }>; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  operative: { label: "Operativo", Icon: CheckCircle2, variant: "operative" },
  blocked: { label: "Bloqueado", Icon: XCircle, variant: "blocked" },
  expiring: { label: "Por vencer", Icon: AlertTriangle, variant: "expiring" },
  maintenance: { label: "Mantenimiento", Icon: Wrench, variant: "maintenance" },
  inactive: { label: "Inactivo", Icon: MinusCircle, variant: "inactive" },
  info: { label: "Info", Icon: Info, variant: "info" },
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusKind;
  label?: string;
  className?: string;
}) {
  const cfg = statusMap[status];
  const Icon = cfg.Icon;
  return (
    <Badge variant={cfg.variant} className={cn("gap-1.5", className)}>
      <Icon className="size-3.5" />
      <span>{label ?? cfg.label}</span>
    </Badge>
  );
}
