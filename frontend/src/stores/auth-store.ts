import { create } from "zustand";
import { fetchAuthSession, getCurrentUser, signOut } from "aws-amplify/auth";
import type { UserRole } from "@shared/constants";

/**
 * Authentication store — hydrated from Cognito at app boot and on token refresh.
 *
 * Role resolution:
 *   - Cognito JWT's `cognito:groups` claim → UserRole[]
 *   - We pick the "highest" group (Admin > Logistics > Purchase > Sales)
 *     as the effective role for UI gating.
 *
 * Session TTL tracking:
 *   - `idleTtlSec` populated from SystemSettings on first fetch (default 1800)
 *   - `lastActivityAt` is bumped by an activity monitor in the layout
 *   - The `SessionExpiryDialog` shows at `lastActivity + ttl - warningMinutes`
 */
export interface AuthUser {
  userId: string;
  email: string;
  username: string;
  groups: UserRole[];
  /** "Highest" group for UI permission checks. */
  role: UserRole | null;
  idToken: string | null;
  accessToken: string | null;
}

interface AuthState {
  user: AuthUser | null;
  status: "unknown" | "loading" | "authenticated" | "unauthenticated";
  lastActivityAt: number;
  idleTtlSec: number;

  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  bumpActivity: () => void;
  setIdleTtl: (seconds: number) => void;

  /** Convenience helpers consumed by guards. */
  hasRole: (role: UserRole | UserRole[]) => boolean;
  isAdmin: () => boolean;
}

const ROLE_PRIORITY: Record<UserRole, number> = {
  Admin: 4,
  Logistics: 3,
  Purchase: 2,
  Sales: 1,
};

function highestRole(groups: UserRole[]): UserRole | null {
  if (!groups.length) return null;
  return groups.slice().sort((a, b) => ROLE_PRIORITY[b] - ROLE_PRIORITY[a])[0]!;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: "unknown",
  lastActivityAt: Date.now(),
  idleTtlSec: 1800,

  refresh: async () => {
    set({ status: "loading" });

    // E2E mock mode: Amplify isn't configured, so skip the real fetchAuthSession
    // call (which would otherwise error out or hang indefinitely) and just flag
    // the user as unauthenticated so the sign-in redirect fires.
    if (import.meta.env.VITE_E2E_MOCK === "1") {
      set({ status: "unauthenticated", user: null });
      return;
    }

    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessToken = session.tokens?.accessToken;
      if (!idToken) {
        set({ status: "unauthenticated", user: null });
        return;
      }
      const current = await getCurrentUser();
      const rawGroups = (idToken.payload["cognito:groups"] ?? []) as string[];
      const groups = rawGroups.filter(
        (g): g is UserRole => g === "Admin" || g === "Logistics" || g === "Purchase" || g === "Sales",
      );
      const role = highestRole(groups);
      set({
        status: "authenticated",
        user: {
          userId: current.userId,
          username: current.username,
          email: (idToken.payload.email as string) ?? current.username,
          groups,
          role,
          idToken: idToken.toString(),
          accessToken: accessToken ? accessToken.toString() : null,
        },
        lastActivityAt: Date.now(),
      });
    } catch (_e) {
      set({ status: "unauthenticated", user: null });
    }
  },

  signOut: async () => {
    await signOut().catch(() => undefined);
    set({ status: "unauthenticated", user: null });
  },

  bumpActivity: () => set({ lastActivityAt: Date.now() }),
  setIdleTtl: (seconds) => set({ idleTtlSec: seconds }),

  hasRole: (role) => {
    const g = get().user?.groups ?? [];
    const wanted = Array.isArray(role) ? role : [role];
    return wanted.some((r) => g.includes(r));
  },
  isAdmin: () => (get().user?.groups ?? []).includes("Admin"),
}));
