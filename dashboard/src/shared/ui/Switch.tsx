import * as SwitchPrimitive from "@radix-ui/react-switch";

type SwitchProps = {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export function Switch({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
}: SwitchProps) {
  const id = `switch-${label.replaceAll(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="switch-field">
      <label className="switch-label" htmlFor={id}>
        <span className="switch-label__title">{label}</span>
        {description ? <span className="field-help">{description}</span> : null}
      </label>
      <SwitchPrimitive.Root
        checked={checked}
        className="switch-root"
        disabled={disabled}
        id={id}
        onCheckedChange={onCheckedChange}
      >
        <SwitchPrimitive.Thumb className="switch-thumb" />
      </SwitchPrimitive.Root>
    </div>
  );
}
