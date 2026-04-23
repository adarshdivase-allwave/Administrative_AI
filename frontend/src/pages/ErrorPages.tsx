import { Link, useRouteError } from "react-router-dom";
import { AlertTriangle, Home, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 404 — route not found. */
export function NotFoundPage() {
  return (
    <Shell
      title="Page not found"
      message="The URL you followed doesn't exist here. It may have moved, or the link may be stale."
      cta={
        <Button asChild>
          <Link to="/">
            <Home className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
      }
    />
  );
}

/** 403 — authenticated but lacks role. */
export function ForbiddenPage() {
  return (
    <Shell
      title="You don't have access to this area"
      message="Ask an administrator to add you to the appropriate role group (Admin / Logistics / Purchase / Sales)."
      cta={
        <Button asChild variant="outline">
          <Link to="/">
            <Home className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
      }
    />
  );
}

/** React Router error boundary target. */
export function RouterErrorBoundary() {
  const error = useRouteError() as { statusText?: string; message?: string } | undefined;
  return (
    <Shell
      title="Something went wrong"
      message={error?.statusText ?? error?.message ?? "Unexpected application error."}
      cta={
        <Button asChild>
          <Link to="/">
            <Home className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
      }
    />
  );
}

function Shell({ title, message, cta }: { title: string; message: string; cta: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-2">
          {cta}
          <Button asChild variant="ghost" size="sm">
            <a href="mailto:ops@example.com">
              <LifeBuoy className="h-4 w-4" /> Contact support
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
