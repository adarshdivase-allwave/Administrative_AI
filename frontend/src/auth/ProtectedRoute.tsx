import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";
import type { UserRole } from "@shared/constants";
import { Skeleton } from "@/components/ui/skeleton";

interface ProtectedRouteProps {
  /** Required role(s). If omitted, any authenticated user is allowed. */
  roles?: UserRole | UserRole[];
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  // Select individual slices. Zustand v5 requires this pattern — returning
  // a new object on every selector call would cause an infinite render loop.
  const status = useAuthStore((s) => s.status);
  const hasRole = useAuthStore((s) => s.hasRole);
  const location = useLocation();

  if (status === "unknown" || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (roles && !hasRole(roles)) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
