import * as React from "react";
import { Check, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { validateGstin, getStateName } from "@shared/gstin";

/**
 * GSTIN input with live Mod-36 checksum validation and state auto-detection.
 * Uncontrolled-ish; integrates with react-hook-form through `register`.
 *
 * Display rules:
 *   - Uppercases input as user types
 *   - Shows green check + state name when checksum passes
 *   - Shows red alert + helpful error otherwise
 *   - Empty field shows neutral helper text
 */
interface GstinInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}

export const GstinInput = React.forwardRef<HTMLInputElement, GstinInputProps>(
  ({ label = "GSTIN", error, value, onChange, required, id, ...props }, ref) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const upper = (value ?? "").toUpperCase();
    const result = upper.length === 15 ? validateGstin(upper) : null;
    const stateName = result?.valid ? result.stateName : upper.length >= 2 ? getStateName(upper) : null;

    return (
      <div className="space-y-1.5">
        {label && (
          <Label htmlFor={fieldId}>
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        )}
        <div className="relative">
          <Input
            id={fieldId}
            ref={ref}
            value={upper}
            onChange={(e) => onChange(e.target.value.toUpperCase().trim())}
            maxLength={15}
            placeholder="27AAPFU0939F1ZV"
            className={cn(
              "font-mono pr-9 uppercase",
              result?.valid && "border-success/50 focus-visible:ring-success/50",
              result && !result.valid && "border-destructive/50 focus-visible:ring-destructive/50",
            )}
            {...props}
          />
          {result && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {result.valid ? (
                <Check className="h-4 w-4 text-success" aria-label="GSTIN valid" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" aria-label="GSTIN invalid" />
              )}
            </span>
          )}
        </div>
        <p
          className={cn(
            "text-[11px]",
            error
              ? "text-destructive"
              : result?.valid
                ? "text-success"
                : result && !result.valid
                  ? "text-destructive"
                  : "text-muted-foreground",
          )}
        >
          {error ??
            (result?.valid
              ? `Valid — ${stateName}`
              : result && !result.valid
                ? result.error
                : stateName
                  ? `State: ${stateName} (enter full 15 characters)`
                  : "15-character GSTIN: [state][PAN][entity]Z[check]")}
        </p>
      </div>
    );
  },
);
GstinInput.displayName = "GstinInput";
