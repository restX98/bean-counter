import { useId } from "react";
import { useSearchParams } from "react-router";
import { BALANCE_RANGES, type BalanceRange } from "../../domain/balances.ts";
import { formatDate } from "../../domain/dates.ts";
import { formatAmount } from "../../domain/money.ts";
import { useBalanceReport, type BalanceReport as Report } from "../api.ts";
import { BalanceChart, type Band } from "../components/BalanceChart.tsx";
import { CurrencySwitch } from "../components/CurrencySwitch.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { ReportTabs } from "../components/Report.tsx";
import { ImportButton } from "../components/Shell.tsx";
import { listNames } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

/** Accounts with their own color; the rest are grouped as Other. */
const COLORS = 6;

const isRange = (text: string): text is BalanceRange =>
  (BALANCE_RANGES as readonly string[]).includes(text);

/**
 * S11, Balance over time: the accounts of one currency stacked, with their
 * total, over the last 3 months, the last year or all time. The currency and
 * range are in the address (?currency=USD&range=All).
 */
export function BalanceReport() {
  const [params, setParams] = useSearchParams();
  const currency = params.get("currency") ?? "";
  const range = params.get("range") ?? "";
  const report = useBalanceReport({
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    range: isRange(range) ? range : null,
  });

  const page = { title: "Reports" };
  const tabs = (
    <ReportTabs currency={/^[A-Z]{3}$/.test(currency) ? currency : null} />
  );
  if (!report.data) {
    return (
      <Page {...page}>
        {tabs}
        <Loading error={report.error} />
      </Page>
    );
  }
  const r = report.data;
  if (r.dates.length === 0) {
    return (
      <Page {...page}>
        {tabs}
        <EmptyState
          icon="chart"
          title="No balances yet"
          action={<ImportButton label="Import a statement" />}
        >
          Import a statement, or set an account's balance, to see your balances
          over time.
        </EmptyState>
      </Page>
    );
  }

  const go = (change: { currency?: string; range?: BalanceRange }) =>
    setParams(
      { currency: r.currency, range: r.range, ...change },
      { replace: true },
    );
  const others = r.currencies.filter((c) => c !== r.currency);

  return (
    <Page {...page}>
      {tabs}
      <div
        className={report.isPlaceholderData ? "report is-loading" : "report"}
      >
        <div className="controls">
          <CurrencySwitch
            currencies={r.currencies}
            value={r.currency}
            onChange={(currency) => go({ currency })}
          />
          <RangeSwitch value={r.range} onChange={(range) => go({ range })} />
        </div>
        <Balances report={r} />
        {r.missing.length > 0 && (
          <p className="caption">
            No total while {listNames(r.missing.map((a) => a.name))}{" "}
            {r.missing.length === 1 ? "has" : "have"} no balance. Set it on the
            account's page to count it.
          </p>
        )}
        {others.length > 0 && (
          <p className="caption">
            Amounts are never converted: switch to {listNames(others, "or")} to
            see those accounts.
          </p>
        )}
      </div>
    </Page>
  );
}

function RangeSwitch({
  value,
  onChange,
}: {
  value: BalanceRange;
  onChange: (range: BalanceRange) => void;
}) {
  const id = useId();
  return (
    <div className="seg" role="radiogroup" aria-label="Range">
      {BALANCE_RANGES.map((range) => (
        <label key={range}>
          <input
            type="radio"
            className="visually-hidden"
            name={`${id}-range`}
            checked={range === value}
            onChange={() => onChange(range)}
          />
          {range}
        </label>
      ))}
    </div>
  );
}

/** The chart and its key, then each account's balance then and now. */
function Balances({ report: r }: { report: Report }) {
  const isMobile = useIsMobile();
  const money = (minor: number, signed = false) =>
    formatAmount(minor, r.currency, { signed });
  const first = r.dates[0]!;
  const last = r.dates.at(-1)!;

  // The biggest balance today at the bottom of the stack.
  const end = (a: Report["accounts"][number]) => a.balances.at(-1) ?? 0;
  const stacked = [...r.accounts].sort((a, b) => end(b) - end(a));
  const own = stacked.length > COLORS ? stacked.slice(0, COLORS - 1) : stacked;
  const rest = stacked.slice(own.length);
  const bands: Band[] = own.map((a, i) => ({
    name: a.name,
    color: `--chart-${i + 1}`,
    values: a.balances,
  }));
  if (rest.length > 0) {
    bands.push({
      name: "Other",
      color: "--chart-other",
      values: r.dates.map((_, i) =>
        rest.every((a) => a.balances[i] === null)
          ? null
          : rest.reduce((sum, a) => sum + (a.balances[i] ?? 0), 0),
      ),
    });
  }
  // The key and the list go top down, as the stack reads.
  const listed = [...stacked].reverse();
  const rows = listed.map((a) => {
    const known = a.balances.findIndex((b) => b !== null);
    const start = a.balances[0] ?? null;
    return {
      ...a,
      start,
      end: end(a),
      since: r.dates[known] ?? first,
    };
  });

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Balance over time</h2>
        </div>
        <BalanceChart
          dates={r.dates}
          bands={bands}
          totals={r.totals}
          currency={r.currency}
          label={`Balance per account, stacked, ${formatDate(first)} to ${formatDate(last)}`}
        />
        <div className="key">
          {[...bands].reverse().map((band) => (
            <span key={band.name}>
              <span
                className="swatch"
                style={{ background: `var(${band.color})` }}
              />
              {band.name}
            </span>
          ))}
          {r.totals && (
            <span>
              <span className="swatch line" />
              Total
            </span>
          )}
        </div>
      </section>

      {isMobile ? (
        <div className="card m-list">
          {rows.map((a) => (
            <div key={a.id} className="m-tx">
              <span className="desc">{a.name}</span>
              <span className="amount">{money(a.end)}</span>
              <span className="meta">
                {a.start === null
                  ? `Counted from ${formatDate(a.since)}`
                  : `${money(a.end - a.start, true)} since ${formatDate(first)}`}
                {a.archived && " · Archived"}
              </span>
            </div>
          ))}
          {r.totals && (
            <div className="m-tx">
              <span className="desc">Total</span>
              <span className="amount">{money(r.totals.at(-1)!)}</span>
              <span className="meta">
                {money(r.totals.at(-1)! - r.totals[0]!, true)} since{" "}
                {formatDate(first)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <section className="card table">
          <div className="br run-4 head">
            <span>Account</span>
            <span className="r">{formatDate(first)}</span>
            <span className="r">{formatDate(last)}</span>
            <span className="r">Change</span>
          </div>
          {rows.map((a) => (
            <div key={a.id} className="br run-4">
              <span className="name">
                {a.name}
                {a.archived && <span className="tag">Archived</span>}
              </span>
              <span
                className="num"
                title={
                  a.start === null
                    ? `Counted from ${formatDate(a.since)}`
                    : undefined
                }
              >
                {a.start === null ? "—" : money(a.start)}
              </span>
              <span className="num">{money(a.end)}</span>
              <span className="num">
                {a.start === null ? "—" : money(a.end - a.start, true)}
              </span>
            </div>
          ))}
          {r.totals && (
            <div className="br run-4 total-row">
              <span className="name">Total</span>
              <span className="num">{money(r.totals[0]!)}</span>
              <span className="num">{money(r.totals.at(-1)!)}</span>
              <span className="num">
                {money(r.totals.at(-1)! - r.totals[0]!, true)}
              </span>
            </div>
          )}
        </section>
      )}
    </>
  );
}
