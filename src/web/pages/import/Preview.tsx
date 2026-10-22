import { useId, useState } from "react";
import type { Account, Anchor } from "../../../domain/accounts.ts";
import { formatWhen, todayIso } from "../../../domain/dates.ts";
import type { Mapping } from "../../../domain/import/mapping.ts";
import {
  isImported,
  type Decision,
  type PlannedRow,
} from "../../../domain/import/plan.ts";
import { findCurrency, formatAmount } from "../../../domain/money.ts";
import {
  useAccounts,
  useCategories,
  useSaveImport,
  usePreview,
  type ImportPreview,
  type ImportResult,
  type UploadedFile,
} from "../../api.ts";
import { FormError, fieldErrors } from "../../components/Dialog.tsx";
import { describedBy, Field } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Loading } from "../../components/Page.tsx";
import { plural, possibleMatches } from "../../labels.ts";
import { useIsMobile } from "../../useIsMobile.ts";
import { Flow } from "./Flow.tsx";

/** Rows shown before "Show all". */
const SHOWN = 100;

/**
 * A new row is one side of a transfer, linked or to pick; otherwise it's
 * auto-categorized, uncategorized or a rule conflict.
 */
type Kind =
  | "near-match"
  | "conflict"
  | "transfer-pick"
  | "uncategorized"
  | "auto"
  | "transfer-linked"
  | "unreadable"
  | "left-out"
  | "duplicate";

/** A row of the file as S9 lists it: what it is, and what happens to it. */
interface Item {
  line: number;
  kind: Kind;
  date: string | null;
  time: string | null;
  description: string;
  /** In the account's currency, or `currency` for a row left out for it. */
  amount: number | null;
  currency: string;
  balance: number | null;
  note: string | null;
  decision: Decision | null;
  /** The category the rules give it, or its transfer's other side. */
  category: string | null;
}

const TAGS: Record<
  Kind,
  { label: string; tone: string; icon?: "alert" | "transfer" }
> = {
  "near-match": { label: "Near-match", tone: "tone-warning", icon: "alert" },
  conflict: { label: "Rule conflict", tone: "tone-warning" },
  "transfer-pick": {
    label: "Transfer to pick",
    tone: "tone-warning",
    icon: "transfer",
  },
  uncategorized: { label: "Uncategorized", tone: "tone-warning" },
  auto: { label: "Auto-categorized", tone: "tone-success" },
  "transfer-linked": {
    label: "Transfer linked",
    tone: "tone-neutral",
    icon: "transfer",
  },
  unreadable: { label: "Can't read", tone: "tone-danger", icon: "alert" },
  "left-out": { label: "Left out", tone: "tone-neutral" },
  duplicate: { label: "Duplicate", tone: "tone-neutral" },
};
/** The order rows are listed in: what needs me first. */
const ORDER: Kind[] = [
  "near-match",
  "conflict",
  "transfer-pick",
  "uncategorized",
  "auto",
  "transfer-linked",
  "unreadable",
  "left-out",
  "duplicate",
];

/** What a new row is, from what the rules say about it. */
const KIND_OF: Record<PlannedRow["rule"]["kind"], Kind> = {
  category: "auto",
  conflict: "conflict",
  none: "uncategorized",
};

function items(
  preview: ImportPreview,
  decisions: Record<number, Decision>,
  currency: string,
  names: Map<number, string>,
  accountNames: Map<number, string>,
): Item[] {
  const planned = preview.rows.map((row): Item => {
    const { rule, transfer } = row;
    // The categories the rules that match disagree on.
    const disagree =
      rule.kind === "conflict"
        ? [...new Set(rule.rules.map((r) => names.get(r.categoryId)))]
        : [];
    const note =
      row.status === "duplicate"
        ? "Already imported · will be skipped"
        : row.status === "near-match" && row.match
          ? `Similar to “${row.match.description}”, already imported on ${formatWhen(row.match.date, row.match.time)}`
          : transfer.kind === "pick"
            ? possibleMatches(
                transfer.count,
                transfer.accountIds.map((a) => accountNames.get(a) ?? ""),
              )
            : rule.kind === "conflict"
              ? `Matches ${plural(rule.rules.length, "rule")}: ${disagree.join(", ")}`
              : null;
    // A transfer comes before what the rules say: it needs no category.
    const kind: Kind =
      row.status !== "new"
        ? row.status
        : transfer.kind === "linked"
          ? "transfer-linked"
          : transfer.kind === "pick"
            ? "transfer-pick"
            : KIND_OF[rule.kind];
    return {
      ...row,
      kind,
      currency,
      note,
      decision:
        row.status === "near-match" ? (decisions[row.line] ?? null) : null,
      category:
        transfer.kind === "linked" && kind === "transfer-linked"
          ? // Linked on its own, so the other side has the same amount.
            `⇄ ${accountNames.get(transfer.accountId)} · ${formatAmount(-row.amount, currency, { signed: true })}`
          : rule.kind === "category" && kind === "auto"
            ? (names.get(rule.categoryId) ?? null)
            : null,
    };
  });
  const leftOut = preview.leftOut.map((row): Item => ({
    ...row,
    kind: "left-out",
    time: null,
    // A row left out for its currency is in that currency, when it's one.
    currency:
      row.reason === "currency" && findCurrency(row.value)
        ? row.value
        : currency,
    balance: null,
    note:
      row.reason === "currency"
        ? `In ${row.value} · will be left out`
        : `${row.value} · will be left out`,
    decision: null,
    category: null,
  }));
  const unreadable = preview.unreadable.map((row): Item => ({
    line: row.line,
    kind: "unreadable",
    date: null,
    time: null,
    description: `Line ${row.line}`,
    amount: null,
    currency,
    balance: null,
    note: row.problems.join(" "),
    decision: null,
    category: null,
  }));
  return [...planned, ...leftOut, ...unreadable].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.line - b.line,
  );
}

const when = (item: Item) =>
  item.date ? formatWhen(item.date, item.time) : "—";

const isSkipped = (item: Item) =>
  item.kind === "duplicate" ||
  item.kind === "left-out" ||
  item.kind === "unreadable" ||
  item.decision === "skip";

interface Props {
  account: Account;
  file: UploadedFile;
  mapping: Mapping;
  /** The preset to save the mapping as, or null not to. */
  presetName: string | null;
  /** Steps passed over, for the stepper. */
  skipped: number[];
  onBack: () => void;
  onClose: () => void;
  onDone: (result: ImportResult, before: Anchor | null) => void;
}

/** S9: every row and what will happen to it; near-matches wait for me. */
export function PreviewStep({
  account,
  file,
  mapping,
  presetName,
  skipped,
  onBack,
  onClose,
  onDone,
}: Props) {
  const id = useId();
  const isMobile = useIsMobile();
  const preview = usePreview(file.id, mapping);
  const categories = useCategories();
  const { data: accounts = [] } = useAccounts();
  const save = useSaveImport(file.id);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [balance, setBalance] = useState({ amount: "", date: todayIso() });
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [showAll, setShowAll] = useState(false);

  const back = (
    <button type="button" className="btn btn-secondary" onClick={onBack}>
      ← Back
    </button>
  );
  if (!preview.data || !categories.data) {
    return (
      <Flow step={3} skipped={skipped} onClose={onClose} back={back}>
        <Loading error={preview.error ?? categories.error} />
      </Flow>
    );
  }

  const data = preview.data;
  const names = new Map(categories.data.categories.map((c) => [c.id, c.name]));
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const all = items(data, decisions, account.currency, names, accountNames);
  const rows: PlannedRow[] = data.rows.map((row) => ({
    ...row,
    decision:
      row.status === "near-match" ? (decisions[row.line] ?? null) : null,
  }));
  const toImport = rows.filter(isImported).length;
  const undecided = rows.filter(
    (r) => r.status === "near-match" && !r.decision,
  ).length;
  const needsBalance = data.needsBalance && !balance.amount.trim();
  const otherCurrencies = [
    ...new Set(
      data.leftOut.filter((r) => r.reason === "currency").map((r) => r.value),
    ),
  ];
  const hasBalances = data.rows.some((r) => r.balance !== null);
  const errors = fieldErrors(save.error);
  const balanceError = errors.anchorAmount ?? errors.anchorDate;

  const blockers = [
    undecided > 0 &&
      `decide ${plural(undecided, "near-match", "near-matches")}`,
    needsBalance && "enter the balance",
  ].filter(Boolean);
  const hint =
    rows.length === 0 && otherCurrencies.length > 0
      ? `None of this file's rows are in ${account.currency}: import it into a ${otherCurrencies[0]} account.`
      : toImport === 0 && undecided === 0
        ? `Nothing new to import: it's all in ${account.name} already.`
        : blockers.length > 0
          ? `${blockers.join(" and ").replace(/^./, (c) => c.toUpperCase())} to import.`
          : "Nothing blocks the import.";
  const ready = blockers.length === 0 && toImport > 0;

  const counts = new Map<Kind, number>();
  for (const item of all)
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const listed = all.filter((item) => filter === "all" || item.kind === filter);
  const shown = showAll ? listed : listed.slice(0, SHOWN);

  const decide = (line: number, decision: Decision) =>
    setDecisions((current) => ({ ...current, [line]: decision }));
  const keepOrSkip = (item: Item) => (
    <div
      className="seg"
      role="radiogroup"
      aria-label={`Keep or skip ${item.description}`}
    >
      {(["keep", "skip"] as const).map((decision) => (
        <label key={decision}>
          <input
            type="radio"
            className="visually-hidden"
            name={`${id}-${item.line}`}
            checked={item.decision === decision}
            onChange={() => decide(item.line, decision)}
          />
          {decision === "keep" ? "Keep" : "Skip"}
        </label>
      ))}
    </div>
  );
  const tag = (item: Item) => {
    const { label, tone, icon } = TAGS[item.kind];
    return (
      <span className={`tag ${tone}`}>
        {icon && <Icon name={icon} />}
        {label}
      </span>
    );
  };
  const amount = (item: Item) =>
    item.amount === null
      ? "—"
      : formatAmount(item.amount, item.currency, { signed: true });
  const amountClass = (item: Item) =>
    item.kind === "transfer-linked"
      ? "amount transfer"
      : item.amount !== null && item.amount > 0 && !isSkipped(item)
        ? "amount income"
        : "amount";

  const importNow = () =>
    save.mutate(
      {
        mapping,
        decisions,
        balance: data.needsBalance ? balance : undefined,
        presetName,
      },
      { onSuccess: (result) => onDone(result, account.anchor) },
    );

  return (
    <Flow
      step={3}
      skipped={skipped}
      onClose={onClose}
      back={back}
      next={
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || save.isPending}
          onClick={importNow}
        >
          {isMobile
            ? "Import"
            : ready
              ? `Import ${plural(toImport, "transaction")}`
              : "Import transactions"}
        </button>
      }
      hint={hint}
    >
      <FormError error={save.error} />

      <div className="chips scroll" role="group" aria-label="Show">
        {(["all", ...ORDER] as const)
          .filter((kind) => kind === "all" || counts.get(kind))
          .map((kind) => (
            <button
              type="button"
              key={kind}
              className="chip"
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {kind === "all" ? "All" : TAGS[kind].label}{" "}
              <span className="count">
                {kind === "all" ? all.length : counts.get(kind)}
              </span>
            </button>
          ))}
      </div>

      {data.needsBalance && (
        <section className="card is-warning">
          <div className="card-head">
            <h2 className="card-title title-icon">
              <Icon name="alert" />
              Current balance needed
            </h2>
          </div>
          <p className="muted">
            {account.name} has no balance yet, and this file has no balance
            column. Enter today's balance from your bank app.
          </p>
          <Field
            id={`${id}-balance`}
            label="Current balance and its date"
            error={balanceError}
          >
            <div className="field-row">
              <input
                id={`${id}-balance`}
                className="input"
                value={balance.amount}
                onChange={(e) =>
                  setBalance({ ...balance, amount: e.target.value })
                }
                placeholder="e.g. 3,240.50"
                inputMode="decimal"
                autoComplete="off"
                {...describedBy(`${id}-balance`, balanceError)}
              />
              <input
                type="date"
                className="input"
                aria-label="Date of the balance"
                value={balance.date}
                max={todayIso()}
                onChange={(e) =>
                  setBalance({ ...balance, date: e.target.value })
                }
                aria-invalid={errors.anchorDate ? true : undefined}
              />
            </div>
          </Field>
        </section>
      )}
      {rows.length === 0 && otherCurrencies.length > 0 && (
        <div className="banner tone-warning" role="status">
          <Icon name="alert" />
          <span className="text">
            <strong>Nothing to import into {account.name}</strong>
            This file's rows are in {otherCurrencies.join(", ")}, and{" "}
            {account.name} is in {account.currency}. Go back and choose a{" "}
            {otherCurrencies[0]} account, or add one.
          </span>
        </div>
      )}
      {hasBalances && (
        <div className="banner tone-info">
          <Icon name="info" />
          <span className="text">
            <strong>Balance column found</strong>
            The balance check runs after the import.
          </span>
        </div>
      )}

      {isMobile ? (
        shown.map((item) => (
          <div
            key={`${item.kind}-${item.line}`}
            className={
              isSkipped(item) ? "card m-item is-skipped" : "card m-item"
            }
          >
            <span>{tag(item)}</span>
            <span className={amountClass(item)}>{amount(item)}</span>
            <span className="what">
              <strong>{item.description || "—"}</strong>
              <span className="caption">
                {[item.date && when(item), item.category, item.note]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {item.kind === "near-match" && (
              <span className="acts">{keepOrSkip(item)}</span>
            )}
          </div>
        ))
      ) : (
        <section className="card table">
          <div
            className={hasBalances ? "ir bal head" : "ir head"}
            aria-hidden="true"
          >
            <span>Status</span>
            <span>Date</span>
            <span>Description</span>
            <span className="r">Amount</span>
            {hasBalances && <span className="r">Bank balance</span>}
            <span>Category or decision</span>
          </div>
          {shown.map((item) => (
            <div
              key={`${item.kind}-${item.line}`}
              className={[
                "ir",
                hasBalances && "bal",
                isSkipped(item) && "is-skipped",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span>{tag(item)}</span>
              <span className="date">{when(item)}</span>
              <span className="desc">
                {item.description || "—"}
                {item.note && <span className="caption">{item.note}</span>}
              </span>
              <span className={amountClass(item)}>{amount(item)}</span>
              {hasBalances && (
                <span className="bank">
                  {item.balance === null
                    ? ""
                    : formatAmount(item.balance, account.currency)}
                </span>
              )}
              <span className="decide">
                {item.kind === "near-match" ? keepOrSkip(item) : item.category}
              </span>
            </div>
          ))}
          {listed.length > shown.length && (
            <div className="table-foot">
              <span>… {plural(listed.length - shown.length, "more row")}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAll(true)}
              >
                Show all
              </button>
            </div>
          )}
        </section>
      )}
      {isMobile && listed.length > shown.length && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowAll(true)}
        >
          Show all {listed.length} rows
        </button>
      )}
      {isMobile && <p className="caption">{hint}</p>}
    </Flow>
  );
}
