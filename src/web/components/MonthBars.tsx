import { useState } from "react";
import { formatMonth } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { compact, niceStep, useWidth } from "./chart.ts";

export interface MonthBar {
  /** "2026-10". */
  month: string;
  income: number;
  /** Negative, as the report adds it up. */
  expenses: number;
}

const HEIGHT = 180;
/** Room for the amounts on the left, and the months underneath. */
const AXIS = 44;
const BELOW = 24;
/** A column's widest, and the gap between a month's two. */
const BAR = 16;
const GAP = 2;

/** A column with a rounded top, standing on the baseline. */
function column(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + width - r}A${r},${r} 0 0 1 ${x + width},${y + r}V${y + height}Z`;
}

/**
 * S12's last 12 months: each month's income and expenses side by side, from
 * one baseline. Each month is a button that opens it; its values show on
 * hover and focus, and screen readers hear them in its name.
 */
export function MonthBars({
  months,
  currency,
  thisMonth,
  onPick,
}: {
  months: MonthBar[];
  currency: string;
  /** The month that's still going, drawn fainter. */
  thisMonth: string;
  onPick: (month: string) => void;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const money = (minor: number) =>
    formatAmount(minor, currency, { signed: true });

  const plot = Math.max(width - AXIS, 0);
  const band = plot / months.length;
  const bar = Math.min(BAR, band * 0.3);
  const max = Math.max(...months.flatMap((m) => [m.income, -m.expenses]), 0);
  const step = niceStep(max);
  const top = Math.max(Math.ceil(max / step), 1) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const y = (value: number) => HEIGHT - (Math.max(value, 0) / top) * HEIGHT;
  const center = (i: number) => AXIS + band * (i + 0.5);
  // A narrow chart names every third month.
  const named = (i: number) => width >= 480 || i % 3 === 0;
  const shown = active === null ? null : months[active];
  // The tooltip goes beside the month, where there's more room.
  const tip = (i: number) => {
    const left = AXIS + band * i;
    return left > width - left - band
      ? { right: width - left + 8 }
      : { left: left + band + 8 };
  };

  return (
    <div className="barchart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT + BELOW} aria-hidden="true">
          {active !== null && (
            <rect
              className="band"
              x={AXIS + band * active}
              y={0}
              width={band}
              height={HEIGHT}
            />
          )}
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
          {months.map((m, i) => (
            <g
              key={m.month}
              className={m.month === thisMonth ? "is-current" : undefined}
            >
              {m.income > 0 && (
                <path
                  className="income"
                  d={column(
                    center(i) - bar - GAP / 2,
                    y(m.income),
                    bar,
                    HEIGHT - y(m.income),
                  )}
                />
              )}
              {m.expenses < 0 && (
                <path
                  className="expenses"
                  d={column(
                    center(i) + GAP / 2,
                    y(-m.expenses),
                    bar,
                    HEIGHT - y(-m.expenses),
                  )}
                />
              )}
              {named(i) && (
                <text
                  className="tick"
                  x={center(i)}
                  y={HEIGHT + BELOW - 6}
                  textAnchor="middle"
                >
                  {formatMonth(m.month, { short: true }).slice(0, 3)}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      {months.map((m, i) => (
        <button
          key={m.month}
          type="button"
          className="bar-hit"
          style={{ left: AXIS + band * i, width: band, height: HEIGHT }}
          aria-label={`${formatMonth(m.month)}: income ${money(m.income)}, expenses ${money(m.expenses)}`}
          onPointerEnter={() => setActive(i)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(i)}
          onBlur={() => setActive(null)}
          onClick={() => onPick(m.month)}
        />
      ))}
      {shown && active !== null && (
        <div className="chart-tip" aria-hidden="true" style={tip(active)}>
          <strong>{formatMonth(shown.month)}</strong>
          <span className="tip-row">
            <span className="tip-key income" />
            <strong>{money(shown.income)}</strong> Income
          </span>
          <span className="tip-row">
            <span className="tip-key expenses" />
            <strong>{money(shown.expenses)}</strong> Expenses
          </span>
        </div>
      )}
    </div>
  );
}
