import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Minimal checkbox using the native input + a styled overlay. We avoid
 * @radix-ui/react-checkbox here because its wrapper-div-as-input pattern
 * breaks react-hook-form's ref forwarding in some edge cases.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, ...props }, ref) => (
    <label className={cn("relative inline-flex h-4 w-4 items-center justify-center", className)}>
      <input
        type="checkbox"
        ref={ref}
        checked={checked}
        className="peer absolute inset-0 cursor-pointer appearance-none rounded border border-input bg-background shadow-sm checked:bg-primary checked:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...props}
      />
      <Check className="pointer-events-none h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100" />
    </label>
  ),
);
Checkbox.displayName = "Checkbox";
