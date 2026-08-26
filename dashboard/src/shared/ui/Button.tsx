import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "touch";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
};

/**
 * Radix의 `asChild`(Drawer의 Trigger·Close, Tooltip의 Trigger)가 이 버튼을
 * 감싸므로 ref를 전달해야 한다. 그렇지 않으면 Radix가 실제 DOM 노드를 잡지
 * 못해 위치 계산과 포커스 관리가 조용히 어긋난다.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled,
      leadingIcon,
      loading = false,
      size = "md",
      variant = "secondary",
      ...props
    },
    ref,
  ) {
    const classes = [
      "button",
      `button--${variant}`,
      size !== "md" ? `button--${size}` : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        aria-busy={loading || undefined}
        aria-disabled={disabled || loading || undefined}
        className={classes}
        disabled={disabled || loading}
        ref={ref}
        type="button"
        {...props}
      >
        {loading ? (
          <span aria-hidden="true" className="button__spinner" />
        ) : (
          leadingIcon
        )}
        <span>{children}</span>
      </button>
    );
  },
);
