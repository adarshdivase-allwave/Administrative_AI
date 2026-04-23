import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

/**
 * Money input with INR symbol prefix, numeric-only keypad, and a subtle
 * "Indian grouping" preview (e.g. 12,34,567.89) shown as muted helper text
 * so users can eyeball large numbers without committing to a locked-in mask.
 */
interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  error?: string;
  required?: boolean;
  currencySymbol?: string;
  showIndianPreview?: boolean;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      label,
      error,
      required,
      currencySymbol = "₹",
      showIndianPreview = true,
      className,
      id,
      value,
      ...props
    },
    ref,
  ) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const numeric = typeof value === "number" ? value : Number(value ?? 0);
    const preview =
      showIndianPreview && Number.isFinite(numeric) && numeric !== 0
        ? new Intl.NumberFormat("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(numeric)
        : null;

    return (
      <div className="space-y-1.5">
        {label && (
          <Label htmlFor={fieldId}>
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        )}
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {currencySymbol}
          </span>
          <Input
            id={fieldId}
            ref={ref}
            type="number"
            step="0.01"
            inputMode="decimal"
            value={value as never}
            className={cn("pl-7 font-mono", className)}
            {...props}
          />
        </div>
        {error ? (
          <p className="text-[11px] text-destructive">{error}</p>
        ) : preview ? (
          <p className="text-[11px] text-muted-foreground font-mono">
            {currencySymbol} {preview}
          </p>
        ) : null}
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";
