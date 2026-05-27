import * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-card p-5", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-32" />
      <Skeleton className="mt-3 h-3 w-16" />
    </div>
  );
}

function SkeletonKpi({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-card p-5", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-28" />
    </div>
  );
}

function SkeletonTable({ rows = 6, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border/60 overflow-hidden", className)}>
      <div className="bg-muted/50 px-3 py-2.5 flex gap-6 border-b border-border/60">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-3 py-3 flex gap-6">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-card p-5", className)}>
      <Skeleton className="h-4 w-40" />
      <div className="mt-5 flex items-end gap-2 h-48">
        {[0.4, 0.7, 0.55, 0.9, 0.6, 0.75, 0.45].map((h, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: `${h * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

export { Skeleton, SkeletonCard, SkeletonKpi, SkeletonTable, SkeletonChart };
