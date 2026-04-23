import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

/**
 * Mobile camera barcode scanner built on `html5-qrcode`.
 *
 * Supports both 1D (Code128, EAN, Code39, UPC-A) and 2D (QR, Data Matrix)
 * codes — covers virtually every AV-industry serial-number label format.
 *
 * Requirements:
 *   - HTTPS (or localhost). Camera APIs refuse to work over HTTP.
 *   - User permission prompt at first use — subsequent opens reuse the grant.
 *
 * UX pattern:
 *   - `<CameraScannerButton onScan={...}>` is the public entry.
 *   - Click opens a full-screen dialog with live camera preview.
 *   - Every successful detection fires `onScan(code)` and dismisses the dialog
 *     (unless `continuous` is set — useful for receiving a whole shipment).
 *   - Visual feedback: green corner ticks on detection, buzz/audio optional.
 *
 * Dynamically imported to keep the cold-start bundle lean — the scanner
 * lib is ~400 KB and most users never open it on a desktop session.
 */

interface CameraScannerButtonProps {
  onScan: (code: string) => void;
  label?: string;
  continuous?: boolean;
  disabled?: boolean;
}

export function CameraScannerButton({
  onScan,
  label = "Scan camera",
  continuous = false,
  disabled,
}: CameraScannerButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Camera className="h-4 w-4" /> {label}
      </Button>
      {open && (
        <ScannerDialog
          onScan={(code) => {
            onScan(code);
            if (!continuous) setOpen(false);
          }}
          onClose={() => setOpen(false)}
          continuous={continuous}
        />
      )}
    </>
  );
}

function ScannerDialog({
  onScan,
  onClose,
  continuous,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
  continuous: boolean;
}) {
  const containerId = "camera-scanner-region";
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const scannerRef = useRef<unknown>(null);
  const recentScansRef = useRef<Map<string, number>>(new Map());
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const handleDetected = useCallback(
    (decoded: string) => {
      const now = Date.now();
      const recent = recentScansRef.current.get(decoded);
      // Debounce duplicate reads of the same code within 2s.
      if (recent && now - recent < 2000) return;
      recentScansRef.current.set(decoded, now);

      setLastCode(decoded);
      setScanCount((n) => n + 1);
      onScanRef.current(decoded);

      // Light haptic + audio cue on mobile devices.
      if (navigator.vibrate) navigator.vibrate(60);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // html5-qrcode ships as ES module — lazy-load so main bundle stays small.
        const mod = await import("html5-qrcode");
        const { Html5Qrcode } = mod;
        if (cancelled) return;

        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner as unknown;

        // Prefer rear camera on mobile.
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (w: number, h: number) => {
              // 75% of the shorter side, square-ish.
              const side = Math.floor(Math.min(w, h) * 0.75);
              return { width: side, height: side };
            },
            aspectRatio: 1.33,
          },
          (decoded) => handleDetected(decoded),
          () => undefined, // swallow per-frame "no detection" noise
        );
        if (cancelled) {
          await scanner.stop();
          return;
        }
        setStarting(false);
      } catch (e) {
        const msg = (e as Error).message ?? "Camera unavailable";
        if (/Permission|NotAllowed/i.test(msg)) {
          setError("Camera access denied. Grant permission in your browser settings and retry.");
        } else if (/NotFound|NotReadable/i.test(msg)) {
          setError("No camera found on this device.");
        } else if (/insecure|HTTPS/i.test(msg)) {
          setError("Camera requires HTTPS. Deploy to HTTPS or test on localhost.");
        } else {
          setError(msg);
        }
        setStarting(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (s?.stop) {
        void s
          .stop()
          .then(() => s.clear?.())
          .catch(() => undefined);
      }
    };
  }, [handleDetected]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-4 w-4" /> Camera scanner
          </DialogTitle>
          <DialogDescription>
            Point the camera at a QR code or barcode. Hold steady for ~1 second.
          </DialogDescription>
        </DialogHeader>

        <div className="relative bg-black" style={{ aspectRatio: "4 / 3" }}>
          {starting && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Starting camera…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm p-4 text-center space-y-2">
              <CameraOff className="h-8 w-8 opacity-80" />
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            </div>
          )}
          <div id={containerId} className={cn("h-full w-full", error && "hidden")} />
          {/* Corner-ticks overlay */}
          {!error && !starting && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-3/4 aspect-square border-2 border-transparent">
                <span className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-white" />
                <span className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-white" />
                <span className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-white" />
                <span className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-white" />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-3 border-t bg-card">
          <div className="text-xs">
            {continuous ? (
              <>
                <Badge variant="outline" className="mr-2">Continuous</Badge>
                <span className="text-muted-foreground">{scanCount} scan{scanCount !== 1 ? "s" : ""}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Tap to cancel</span>
            )}
            {lastCode && (
              <div className="font-mono text-[10px] text-muted-foreground mt-0.5 truncate max-w-[240px]">
                Last: {lastCode}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            {continuous ? "Done" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
