import * as React from "react";
import { AlertCircle, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { validateHsn } from "@shared/hsn";

/**
 * HSN / SAC code input with real-time format validation.
 * Strips spaces as user types (Tally normalization happens inline).
 */
interface HsnInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  error?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}

export const HsnInput = React.forwardRef<HTMLInputElement, HsnInputProps>(
  ({ label = "HSN / SAC", error, required, id, value, onChange, ...props }, ref) => {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const stripped = (value ?? "").replace(/\s+/g, "");
    const validation = stripped.length >= 4 ? validateHsn(stripped) : null;

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
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\s+/g, ""))}
            inputMode="numeric"
            maxLength={8}
            placeholder="85287200"
            className={cn(
              "font-mono pr-9",
              validation?.valid && "border-success/50",
              validation && !validation.valid && "border-destructive/50",
            )}
            {...props}
          />
          {validation && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {validation.valid ? (
                <Check className="h-4 w-4 text-success" aria-label="HSN valid" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive" aria-label="HSN invalid" />
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : validation?.valid ? (
            <>
              <Badge variant="success" className="text-[10px]">
                {validation.isSac ? "SAC" : "HSN"} {validation.length}d
              </Badge>
              <span className="text-muted-foreground">Tally-compatible</span>
            </>
          ) : validation ? (
            <p className="text-destructive">{validation.error}</p>
          ) : (
            <p className="text-muted-foreground">4 / 6 / 8-digit HSN, or 6-digit SAC (99xxxx)</p>
          )}
        </div>
      </div>
    );
  },
);
HsnInput.displayName = "HsnInput";
