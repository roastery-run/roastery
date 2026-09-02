import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes, letting the caller's win.
 *
 * `twMerge` is what makes `<Button className="h-7">` actually override the
 * variant's `h-8` instead of producing two conflicting classes whose winner
 * depends on stylesheet order.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
