import type { ReactNode } from "react";
import { useNavigate } from "react-router";

export interface DonutSlice {
  key: string;
  amount: number;
  /** Its chart color, 1 to 6; null for Other, in gray. */
  color: number | null;
  /** Where a click on it goes, if anywhere. */
  to: string | null;
}

/** The ring's middle, and its width, in a 200 × 200 box. */
const RADIUS = 70;
const RING = 32;
/** The surface left between two slices. */
const GAP = 2;
const AROUND = 2 * Math.PI * RADIUS;

/**
 * S13's chart: each slice's part of the whole, clockwise from the top,
 * with what's in the middle up to the caller (the total, or the slice I
 * point at). The list beside it names every slice and holds the links, so
 * screen readers get the list and the ring only says what it shows.
 */
export function Donut({
  slices,
  label,
  active,
  onActive,
  children,
}: {
  slices: DonutSlice[];
  label: string;
  /** The slice to bring forward, as a row of the list points at it. */
  active: string | null;
  onActive: (key: string | null) => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  // Where each slice starts, along the ring.
  const starts = slices.map(
    (_, i) =>
      (slices.slice(0, i).reduce((sum, s) => sum + s.amount, 0) / total) *
      AROUND,
  );
  return (
    <div className={active === null ? "donut" : "donut has-active"}>
      <svg viewBox="0 0 200 200" role="img" aria-label={label}>
        {slices.map((s, i) => {
          const length = (s.amount / total) * AROUND;
          const dash =
            slices.length === 1 ? AROUND : Math.max(length - GAP, 0.5);
          return (
            <circle
              key={s.key}
              className={
                [s.key === active && "is-active", s.to && "is-link"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              cx={100}
              cy={100}
              r={RADIUS}
              strokeWidth={RING}
              style={{
                stroke: s.color ? `var(--chart-${s.color})` : undefined,
              }}
              strokeDasharray={`${dash} ${AROUND}`}
              strokeDashoffset={-starts[i]!}
              transform="rotate(-90 100 100)"
              onPointerEnter={() => onActive(s.key)}
              onPointerLeave={() => onActive(null)}
              onClick={() => s.to && navigate(s.to)}
            />
          );
        })}
      </svg>
      <div className="donut-center" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}
