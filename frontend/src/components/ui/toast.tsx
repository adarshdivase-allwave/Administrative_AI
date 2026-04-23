import { Toaster as HotToaster, toast as hotToast, type Toast } from "react-hot-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * react-hot-toast wrapper themed to match our design tokens.
 * Use via `toast.success("...")`, `toast.error(...)`, etc.
 *
 * The default exported `Toaster` component mounts once at the app root.
 */

export function Toaster() {
  return (
    <HotToaster
      position="top-right"
      gutter={8}
      containerClassName="!top-16 !right-4" // clear the topbar
      toastOptions={{
        duration: 5000,
        className: "!p-0 !bg-transparent !shadow-none",
      }}
    >
      {(t) => <StyledToast t={t} />}
    </HotToaster>
  );
}

function StyledToast({ t }: { t: Toast }) {
  const Icon = toastIcon(t.type);
  const tone =
    t.type === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : t.type === "success"
        ? "border-success/40 bg-success/10 text-success"
        : "border-border bg-card text-card-foreground";

  return (
    <div
      className={cn(
        "flex w-[360px] items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur",
        tone,
        t.visible ? "animate-slide-up" : "opacity-0",
      )}
      role="status"
    >
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
      <div className="flex-1 text-sm leading-snug">{t.message as React.ReactNode}</div>
      <button
        type="button"
        onClick={() => hotToast.dismiss(t.id)}
        className="ml-2 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function toastIcon(type: Toast["type"]) {
  switch (type) {
    case "success":
      return CheckCircle2;
    case "error":
      return XCircle;
    case "loading":
      return Info;
    default:
      return AlertTriangle;
  }
}

/** Re-export with our nicer signature so callers import from one place. */
export const toast = hotToast;
