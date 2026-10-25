import { useState } from "react";
import { formatDate, formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useIsMobile } from "../useIsMobile.ts";
import { compact, niceStep, useWidth } from "./chart.ts";

/** One band of the stack: an account, or the accounts grouped as Other. */
export interface Band {
  name: string;
  /** A --chart-* token. */
  color: string;
  /** The end-of-day balance on each date: null before it's known. */
  values: (number | null)[];
}

/** Room for the amounts on the left, and the months underneath. */
const AXIS = 44;
const BELOW = 24;
/** Over two years, only the years are named. */
const LONG = 731;

/**
 * S11's chart: the bands stacked from the bottom, an unknown balance counting
 * for nothing, with the total as a line on top and its last value at the end.
 * Pointing at a day shows its balances.
 */
export function BalanceChart({
  dates,
  bands,
  totals,
  currency,
  label,
}: {
  dates: string[];
  /** Bottom first. */
  bands: Band[];
  /** Left out while an account has no balance. */
  totals: number[] | null;
  currency: string;
  label: string;
}) {
  const [ref, width] = useWidth();
  const height = useIsMobile() ? 180 : 240;
  const [active, setActive] = useState<number | null>(null);
  const money = (minor: number) => formatAmount(minor, currency);

  const count = dates.length;
  // The tops of the bands, bottom first.
  const tops: number[][] = [];
  bands.forEach((band, k) =>
    tops.push(
      band.values.map((v, i) => (k > 0 ? tops[k - 1]![i]! : 0) + (v ?? 0)),
    ),
  );
  const all = [0, ...tops.flat(), ...(totals ?? [])];
  const step = niceStep(Math.max(...all) - Math.min(...all));
  const top = Math.max(Math.ceil(Math.max(...all) / step), 1) * step;
  const bottom = Math.floor(Math.min(...all) / step) * step;
  const ticks = Array.from(
    { length: Math.round((top - bottom) / step) + 1 },
    (_, i) => bottom + i * step,
  );
  const y = (value: number) =>
    height - ((value - bottom) / (top - bottom)) * height;
  const plot = Math.max(width - AXIS, 0);
  const x = (i: number) =>
    AXIS + (count > 1 ? (plot * i) / (count - 1) : plot / 2);

  // A single day is drawn across the whole width.
  const across = (values: number[]) =>
    count > 1
      ? values.map((v, i) => `${x(i)},${y(v)}`)
      : [`${AXIS},${y(values[0]!)}`, `${AXIS + plot},${y(values[0]!)}`];
  const area = (k: number) => {
    const upper = across(tops[k]!);
    const lower = across(k > 0 ? tops[k - 1]! : tops[k]!.map(() => 0));
    return `${upper.join(" ")} ${lower.reverse().join(" ")}`;
  };

  // Each month's first day is named; over two years, each year's.
  const long = count > LONG;
  const named = dates.flatMap((date, i) =>
    date.endsWith(long ? "-01-01" : "-01") ? [i] : [],
  );
  const shownLabels =
    width >= 480 || long ? named : named.filter((_, n) => n % 3 === 0);
  const name = (date: string) =>
    long || date.slice(5, 7) === "01"
      ? date.slice(0, 4)
      : formatMonth(date.slice(0, 7), { short: true }).slice(0, 3);

  const pick = (clientX: number, element: HTMLElement) => {
    if (count === 0 || plot === 0) return;
    const left = clientX - element.getBoundingClientRect().left;
    const i = Math.round(((left - AXIS) / plot) * (count - 1));
    setActive(Math.min(Math.max(i, 0), count - 1));
  };
  // The tooltip goes beside the day, where there's more room.
  const tip = (i: number) =>
    x(i) > width / 2 ? { right: width - x(i) + 8 } : { left: x(i) + 8 };
  const last = totals?.at(-1);

  return (
    <div
      className="areachart"
      ref={ref}
      role="img"
      aria-label={label}
      onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
      onPointerLeave={() => setActive(null)}
    >
      {width > 0 && count > 0 && (
        <svg width={width} height={height + BELOW} aria-hidden="true">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 0 ? "baseline" : "grid"}
                x1={AXIS}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="tick"
                x={AXIS - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
              >
                {compact(tick)}
              </text>
            </g>
          ))}
          {bands.map((band, k) => (
            <polygon
              key={band.name}
              points={area(k)}
              style={{ fill: `var(${band.color})` }}
            />
          ))}
          {totals && (
            <polyline className="total" points={across(totals).join(" ")} />
          )}
          {active !== null && (
            <line
              className="cursor"
              x1={x(active)}
              x2={x(active)}
              y1={0}
              y2={height}
            />
          )}
          {shownLabels.map((i) => (
            <text
              key={dates[i]}
              className="tick"
              x={x(i)}
              y={height + BELOW - 6}
              textAnchor="middle"
            >
              {name(dates[i]!)}
            </text>
          ))}
        </svg>
      )}
      {width > 0 && last !== undefined && (
        <span className="end-label" aria-hidden="true" style={{ top: y(last) }}>
          {money(last)}
        </span>
      )}
      {active !== null && (
        <div className="chart-tip" aria-hidden="true" style={tip(active)}>
          <strong>{formatDate(dates[active]!)}</strong>
          {[...bands].reverse().map((band) => {
            const value = band.values[active];
            return (
              <span key={band.name} className="tip-row">
                <span
                  className="tip-key"
                  style={{ background: `var(${band.color})` }}
                />
                <strong>
                  {value === null || value === undefined ? "—" : money(value)}
                </strong>{" "}
                {band.name}
              </span>
            );
          })}
          {totals && (
            <span className="tip-row">
              <span className="tip-key total" />
              <strong>{money(totals[active]!)}</strong> Total
            </span>
          )}
        </div>
      )}
    </div>
  );
}
