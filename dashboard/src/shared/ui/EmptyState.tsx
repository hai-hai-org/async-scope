import type { ReactNode } from "react";
import { Button } from "./Button";

type EmptyStateProps = {
  action?: ReactNode;
  description: string;
  title: string;
};

export function EmptyState({ action, description, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div aria-hidden="true" className="empty-state__icon">
        ∅
      </div>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action ?? (
        <Button size="sm" variant="ghost">
          상태 유지
        </Button>
      )}
    </div>
  );
}
