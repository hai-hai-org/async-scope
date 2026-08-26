import type { ReactNode } from "react";

type BadgeTone = "observed" | "inferred" | "error" | "success" | "warning";

type StatusBadgeProps = {
  children: ReactNode;
  icon: string;
  tone: BadgeTone;
};

export function StatusBadge({ children, icon, tone }: StatusBadgeProps) {
  return (
    <span className={`badge badge--${tone}`}>
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </span>
  );
}
