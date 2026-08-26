import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "touch";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
};

export function Button({
  children,
  className,
  disabled,
  leadingIcon,
  loading = false,
  size = "md",
  variant = "secondary",
  ...props
}: ButtonProps) {
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
}
