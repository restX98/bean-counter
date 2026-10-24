import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addMonths, formatMonth } from "../../domain/dates.ts";
import {
  formatRange,
  readPeriod,
  writePeriod,
  type Period,
} from "../../domain/filters.ts";
import { formatAmount } from "../../domain/money.ts";
import {
  useCategories,
  useSpendingReport,
  type SpendingReport,
} from "../api.ts";
import { CurrencySwitch } from "../components/CurrencySwitch.tsx";
import { Donut, type DonutSlice } from "../components/Donut.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import {
  linesTo,
  NotCountedYet,
  ReportTabs,
  WaitingBanner,
} from "../components/Report.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { listNames } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/** "45.0 %", from tenths of a percent. */
const percent = (tenths: number) => `${(tenths / 10).toFixed(1)} %`;

/**
 * S13, Spending by category: whole months in one currency, picked in the
 * address (?period=2026-08..2026-10&currency=USD). Each category, in the
 * list or the chart, opens its transactions.
 */
export function Spending() {
  const [params, setParams] = useSearchParams();
  const currency = params.get("currency") ?? "";
  const asked = {
    period: readPeriod(params.get("period") ?? ""),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
  const report = useSpendingReport(asked);
  const categories = useCategories();
  const isMobile = useIsMobile();
  // The line I point at, in the list or the chart; "other" for the gray
  // slice, which can hold several.
  const [active, setActive] = useState<number | "other" | null>(null);

  const page = { title: "Reports" };
  const tabs = <ReportTabs currency={asked.currency} />;
  if (!report.data) {
    return (
      <Page {...page}>
        {tabs}
        <Loading error={report.error} />
      </Page>
    );
  }
  const r = report.data;
  if (r.first === null) {
    return (
      <Page {...page}>
        {tabs}
        <EmptyState
          icon="chart"
          title="No transactions yet"
          action={<ImportButton label="Import a statement" />}
        >
          Import a statement to see what you spend on each category.
        </EmptyState>
      </Page>
    );
  }

  // The period asked for, even while its numbers are on their way.
  const period = asked.period ?? r.period;
  const go = (change: { period?: Period; currency?: string }) =>
    setParams(
      {
        ...Object.fromEntries(params),
        ...(change.period && { period: writePeriod(change.period) }),
        ...(change.currency && { currency: change.currency }),
      },
      { replace: true },
    );
  const money = (minor: number, signed = false) =>
    formatAmount(minor, r.currency, { signed });
  const name = (line: { categoryId: number | null }) =>
    line.categoryId === null
      ? "Uncategorized"
      : (categories.data?.categories.find((c) => c.id === line.categoryId)
          ?.name ?? "");
  const to = (line: { categoryId: number | null }) =>
    linesTo(line, "expense", {
      period: r.period,
      currency: r.currency,
      currencies: r.currencies,
    });

  // The six largest categories each have a slice; the rest share a gray one.
  const others = r.lines.filter((l) => l.color === null);
  const slices: DonutSlice[] = r.lines
    .filter((l) => l.color !== null)
    .map((l, i) => ({
      key: String(i),
      amount: l.amount,
      color: l.color,
      to: to(l),
    }));
  if (others.length > 0) {
    slices.push({
      key: "other",
      amount: others.reduce((sum, l) => sum + l.amount, 0),
      color: null,
      to: others.length === 1 ? to(others[0]!) : null,
    });
  }
  // What's left out, under the list.
  const notes = (
    <>
      {r.refunded.length > 0 && (
        <p className="caption">
          Refunded more than spent:{" "}
          {listNames(
            r.refunded.map((l) => `${name(l)} ${money(l.amount, true)}`),
          )}
          .
        </p>
      )}
      <NotCountedYet pending={r.pending} currency={r.currency} />
    </>
  );
  const pointed = typeof active === "number" ? r.lines[active] : undefined;
  const slice =
    active === "other" || pointed?.color === null
      ? "other"
      : active === null
        ? null
        : String(active);

  return (
    <Page {...page}>
      {tabs}
      <div
        className={report.isPlaceholderData ? "report is-loading" : "report"}
      >
        <div className="controls">
          <PeriodPicker
            report={r}
            period={period}
            onPick={(period) => go({ period })}
          />
          <CurrencySwitch
            className={isMobile ? "seg fill" : "seg push"}
            currencies={r.currencies}
            value={r.currency}
            onChange={(currency) => go({ currency })}
          />
        </div>

        <WaitingBanner count={r.waiting} />

        {r.lines.length === 0 ? (
          <>
            <EmptyState
              icon="chart"
              title={`No spending in ${formatRange(period)}`}
            >
              No expenses in your {r.currency} accounts in this period. Pick
              another period.
            </EmptyState>
            {notes}
          </>
        ) : (
          <section className="card">
            <div className="chart-row">
              <Donut
                slices={slices}
                label={`Spending by category, ${formatRange(r.period)}`}
                active={slice}
                onActive={(key) =>
                  setActive(key === null || key === "other" ? key : Number(key))
                }
              >
                {pointed ? (
                  <>
                    <span className="caption">{name(pointed)}</span>
                    <strong>{money(pointed.amount)}</strong>
                    <span className="caption">{percent(pointed.share)}</span>
                  </>
                ) : active === "other" ? (
                  <>
                    <span className="caption">
                      {others.length === 1 ? name(others[0]!) : "Other"}
                    </span>
                    <strong>
                      {money(others.reduce((sum, l) => sum + l.amount, 0))}
                    </strong>
                    <span className="caption">
                      {percent(others.reduce((sum, l) => sum + l.share, 0))}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>{money(r.total)}</strong>
                    <span className="caption">{formatRange(r.period)}</span>
                  </>
                )}
              </Donut>
              <div className="share-table cat-rows">
                <div className="cr head">
                  <span />
                  <span>Category</span>
                  <span className="num">Amount</span>
                  <span className="share">Share</span>
                </div>
                {r.lines.map((l, i) => (
                  <Link
                    key={l.categoryId ?? "none"}
                    className={
                      active === i || (active === "other" && l.color === null)
                        ? "cr is-active"
                        : "cr"
                    }
                    to={to(l)}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  >
                    <span
                      className="swatch"
                      style={{
                        background: `var(--chart-${l.color ?? "other"})`,
                      }}
                    />
                    <span>{name(l)}</span>
                    <span className="num">{money(l.amount)}</span>
                    <span className="share">{percent(l.share)}</span>
                  </Link>
                ))}
                <div className="cr total">
                  <span />
                  <span>Total</span>
                  <span className="num">{money(r.total)}</span>
                  <span className="share">{percent(1000)}</span>
                </div>
              </div>
            </div>
            {notes}
          </section>
        )}
      </div>
    </Page>
  );
}

/**
 * The periods on offer, and Custom range, which adds From and To months:
 * any between the first and the newest with transactions.
 */
function PeriodPicker({
  report: r,
  period,
  onPick,
}: {
  report: SpendingReport;
  period: Period;
  onPick: (period: Period) => void;
}) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const key = writePeriod(period);
  const named = r.choices.some((c) => writePeriod(c.period) === key);
  // Newest first, and the period's own months even if they have nothing.
  const months: string[] = [];
  const oldest = r.first! < period.from ? r.first! : period.from;
  for (
    let month = r.last! > period.to ? r.last! : period.to;
    month >= oldest;
    month = addMonths(month, -1)
  ) {
    months.push(month);
  }
  const month = (
    which: "from" | "to",
    label: string,
    pick: (month: string) => Period,
  ) => (
    <>
      <label htmlFor={`${id}-${which}`}>{label}</label>
      <span className="select-wrap">
        <select
          id={`${id}-${which}`}
          className="select"
          value={period[which]}
          onChange={(e) => onPick(pick(e.target.value))}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m, { short: true })}
            </option>
          ))}
        </select>
        <Icon name="chevron" />
      </span>
    </>
  );

  return (
    <>
      <span className="select-wrap">
        <select
          className="select"
          aria-label="Period"
          value={custom || !named ? "custom" : key}
          onChange={(e) => {
            const picked = readPeriod(e.target.value);
            setCustom(!picked);
            if (picked) onPick(picked);
          }}
        >
          {r.choices.map((c) => (
            <option key={c.label} value={writePeriod(c.period)}>
              {c.label} ({formatRange(c.period)})
            </option>
          ))}
          <option value="custom">Custom range</option>
        </select>
        <Icon name="chevron" />
      </span>
      {(custom || !named) && (
        <span className="range">
          {month("from", "From", (from) => ({
            from,
            to: from > period.to ? from : period.to,
          }))}
          {month("to", "To", (to) => ({
            from: to < period.from ? to : period.from,
            to,
          }))}
        </span>
      )}
    </>
  );
}
