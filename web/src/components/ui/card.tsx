import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        // Ring inset en lugar de border — peso visual sin "dibujar"
        "rounded-lg bg-card text-card-foreground",
        "ring-1 ring-inset ring-border/70 dark:ring-white/5",
        "shadow-[0_1px_0_0_rgba(0,0,0,0.04),0_1px_2px_-1px_rgba(0,0,0,0.04)]",
        "dark:shadow-[0_1px_0_0_rgba(0,0,0,0.3)]",
        "transition-[box-shadow,background-color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1 px-5 pt-5 pb-3", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-sm font-semibold leading-tight tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-5 pb-5", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-3 border-t border-border/50 bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
