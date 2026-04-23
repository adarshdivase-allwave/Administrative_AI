import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/stores/auth-store";
import { env } from "@/lib/env";

/**
 * Mounts once inside the authenticated layout. Watches a global pointer/keyboard
 * activity signal and compares `lastActivityAt` against the configured TTL.
 *
 * UX flow:
 *   - 5 min before expiry (configurable): show warning dialog
 *   - At expiry: auto sign-out + redirect to /sign-in?reason=timeout
 *
 * The actual JWT expiry is enforced by Cognito; this UI is the courtesy layer.
 */
export function SessionExpiryMonitor() {
  const nav = useNavigate();
  const lastActivityAt = useAuthStore((s) => s.lastActivityAt);
  const idleTtlSec = useAuthStore((s) => s.idleTtlSec);
  const bumpActivity = useAuthStore((s) => s.bumpActivity);
  const signOut = useAuthStore((s) => s.signOut);
  const [showWarning, setShowWarning] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Bump activity on user interaction.
  useEffect(() => {
    const handler = () => bumpActivity();
    const events: Array<keyof WindowEventMap> = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [bumpActivity]);

  // Tick every 30s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const warnAt = lastActivityAt + (idleTtlSec - env.sessionWarningMinutes * 60) * 1000;
    const expireAt = lastActivityAt + idleTtlSec * 1000;
    if (now >= expireAt) {
      setShowWarning(false);
      void (async () => {
        await signOut();
        nav("/sign-in?reason=timeout", { replace: true });
      })();
    } else if (now >= warnAt) {
      setShowWarning(true);
    } else {
      setShowWarning(false);
    }
  }, [now, lastActivityAt, idleTtlSec, signOut, nav]);

  return (
    <Dialog open={showWarning} onOpenChange={setShowWarning}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Session expiring soon
          </DialogTitle>
          <DialogDescription>
            You&apos;ve been idle for a while. For your security, we&apos;ll sign you out in a few
            minutes unless you continue.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              nav("/sign-in", { replace: true });
            }}
          >
            Sign out now
          </Button>
          <Button
            onClick={() => {
              bumpActivity();
              setShowWarning(false);
            }}
          >
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
