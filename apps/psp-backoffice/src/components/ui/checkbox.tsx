import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<React.ComponentProps<"input">, "type"> & {
  indeterminate?: boolean;
};

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, checked, onChange, disabled, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    React.useEffect(() => {
      if (innerRef.current) {
        innerRef.current.indeterminate = Boolean(indeterminate);
      }
    }, [indeterminate]);

    const isChecked = Boolean(checked);
    const showMinus = Boolean(indeterminate);

    return (
      <label
        className={cn(
          "inline-flex items-center justify-center",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          ref={innerRef}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded border border-[#e3e8ee] bg-white transition-colors",
            "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary)]/35",
            (isChecked || showMinus) && "border-[var(--primary)] bg-[var(--primary)]",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            className,
          )}
        >
          {showMinus ? (
            <Minus className="size-2.5 text-white" strokeWidth={3} aria-hidden />
          ) : isChecked ? (
            <Check className="size-2.5 text-white" strokeWidth={3} aria-hidden />
          ) : null}
        </span>
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
