import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * icon-only control은 accessible name과 visible tooltip을 둘 다 가져야 한다
 * (DESIGN.md §8). 툴팁은 name이 아니라 description이므로 trigger 쪽의
 * aria-label을 없애면 안 된다 — Radix가 aria-describedby로 연결한다.
 *
 * Radix를 쓰는 이유는 WCAG 1.4.13(hover/focus 콘텐츠)의 dismissible(Escape)·
 * hoverable·persistent를 직접 구현하지 않아도 되기 때문이다. CSS ::after
 * 툴팁은 Escape로 닫을 수 없어 그 기준을 만족하지 못한다.
 */

/** 개발 도구에서 툴팁을 오래 기다리게 하지 않는다. */
const DELAY_MS = 200;

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={DELAY_MS}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

type TooltipProps = {
  children: ReactNode;
  label: string;
  side?: "top" | "right" | "bottom" | "left";
};

export function Tooltip({ children, label, side = "bottom" }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="tooltip"
          side={side}
          sideOffset={6}
        >
          {label}
          <TooltipPrimitive.Arrow className="tooltip__arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
