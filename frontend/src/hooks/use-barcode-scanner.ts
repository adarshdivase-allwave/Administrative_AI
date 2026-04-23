import { useEffect, useRef } from "react";

/**
 * Hook for USB/Bluetooth barcode scanners that emulate keyboards.
 *
 * Most industrial scanners type the serial at 2000+ cps and end with Enter.
 * We buffer keystrokes globally and invoke `onScan(serial)` whenever we
 * see a chunk of rapid characters followed by Enter.
 *
 * Rules:
 *   - Ignores input when the user is typing in an existing text field
 *     (unless `alwaysListen` is true — useful on dedicated scan pages).
 *   - Chunks are considered a "scan" only when:
 *       a. Length ≥ minLength (default 6)
 *       b. Average inter-key time < thresholdMs (default 50ms) — a human
 *          can't realistically type that fast.
 *
 * Returns a ref you can focus to a hidden input to capture scans into
 * forms even when other fields have focus.
 */
interface Options {
  onScan: (code: string) => void;
  minLength?: number;
  thresholdMs?: number;
  /** When true, ignores the "focus is in an input" check. */
  alwaysListen?: boolean;
}

export function useBarcodeScanner({
  onScan,
  minLength = 6,
  thresholdMs = 50,
  alwaysListen = false,
}: Options) {
  const bufferRef = useRef<string>("");
  const lastKeyAtRef = useRef<number>(0);
  const intervalsRef = useRef<number[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !alwaysListen &&
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;

      const now = performance.now();
      const since = now - (lastKeyAtRef.current || now);

      if (e.key === "Enter") {
        const buf = bufferRef.current;
        const avg =
          intervalsRef.current.length > 0
            ? intervalsRef.current.reduce((a, b) => a + b, 0) / intervalsRef.current.length
            : Infinity;
        const looksScanned = buf.length >= minLength && avg < thresholdMs;
        if (looksScanned) {
          e.preventDefault();
          onScan(buf);
        }
        bufferRef.current = "";
        intervalsRef.current = [];
        lastKeyAtRef.current = 0;
        return;
      }

      // Single-character keys only.
      if (e.key.length !== 1) return;

      if (since > 400) {
        // Big gap — start a new sequence.
        bufferRef.current = e.key;
        intervalsRef.current = [];
      } else {
        bufferRef.current += e.key;
        intervalsRef.current.push(since);
      }
      lastKeyAtRef.current = now;
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onScan, minLength, thresholdMs, alwaysListen]);
}
