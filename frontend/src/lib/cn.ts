import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware `clsx`. Accepts any truthy/falsy conditional class pattern
 * and dedupes conflicting utilities (`p-2 p-4` → `p-4`).
 *
 * Standard pattern used across all components.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
