import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

type BadgeTone = "observed" | "inferred" | "error" | "success" | "warning";

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  icon: string;
  tone: BadgeTone;
  /** Legend처럼 badge 자체가 hover/focus tooltip의 trigger일 때만 켠다.
   * 기본은 비활성 — 그렇지 않으면 헤더·표의 순수 상태 표시 badge에도
   * tab 정지가 생겨 키보드 탐색이 불필요하게 늘어난다. */
  focusable?: boolean;
};

/**
 * Radix `Tooltip`의 `asChild`가 이 badge를 감쌀 수 있으므로(Legend) ref와
 * 나머지 props(onFocus·onMouseEnter·aria-describedby 등)를 실제 DOM 노드로
 * 전달해야 한다. 그렇지 않으면 Trigger가 진짜 span을 잡지 못해 focus·hover
 * 이벤트가 조용히 안 붙는다 — Button.tsx의 같은 이유와 동일하다.
 */
export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge(
    { children, className, focusable, icon, tone, ...props },
    ref,
  ) {
    return (
      <span
        className={["badge", `badge--${tone}`, className ?? ""]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        tabIndex={focusable ? 0 : undefined}
        {...props}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{children}</span>
      </span>
    );
  },
);
