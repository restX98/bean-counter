// What the app's SVG charts share: their width, and the steps of their axis.

import { useLayoutEffect, useRef, useState } from "react";

/** The width of an element, kept up to date. */
export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round step for the axis, so that about four of them reach `max`. */
export function niceStep(max: number): number {
  const raw = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return (
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((step) => step >= raw) ??
    10 * power
  );
}

/** 250000 minor units → "2.5k", 50000 → "500", −250000 → "−2.5k". */
export function compact(minor: number): string {
  const units = minor / 100;
  return Math.abs(units) >= 1000 ? `${units / 1000}k` : String(units);
}
