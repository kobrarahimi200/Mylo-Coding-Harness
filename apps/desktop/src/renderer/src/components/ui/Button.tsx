import type { ComponentPropsWithRef } from "react";
import { cn } from "../../lib/cn";

export function Button({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" &&
          "bg-accent text-on-accent shadow-sm hover:bg-accent-hover hover:shadow-md",
        variant === "secondary" &&
          "border border-hairline bg-surface text-fg shadow-sm hover:border-hairline-strong hover:bg-hover",
        variant === "danger" &&
          "border border-danger/30 bg-surface text-danger shadow-sm hover:bg-danger/10",
        variant === "ghost" && "text-fg-muted hover:bg-hover hover:text-fg",
        className,
      )}
    />
  );
}
