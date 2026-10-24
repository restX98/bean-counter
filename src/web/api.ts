import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Account,
  AccountFields,
  Anchor,
  AnchorFields,
  FieldErrors,
} from "../domain/accounts.ts";
import type { BothBalances, SuspectReason } from "../domain/balances.ts";
import type {
  BudgetFields,
  BudgetMonth,
  BudgetPlan,
  BudgetStatus,
} from "../domain/budgets.ts";
import type { Category, CategoryFields } from "../domain/categories.ts";
import { writePeriod, type Filters, type Period } from "../domain/filters.ts";
import type {
  LeftOutRow,
  Mapping,
  RowError,
} from "../domain/import/mapping.ts";
import type { Decision, PlanGap, PlannedRow } from "../domain/import/plan.ts";
import type {
  PeriodChoice,
  ReportLine,
  ReportSide,
  SpendingLine,
} from "../domain/reports.ts";
import type { TableRow } from "../domain/import/table.ts";
import type {
  ReviewGroups,
  ReviewTarget,
  Suggestion,
} from "../domain/review.ts";
import type { Rule, RuleFields } from "../domain/rules.ts";

export class ApiError extends Error {
  readonly status: number;
  /** Messages for form fields, by field name. */
  readonly errors: FieldErrors;

  constructor(status: number, message: string, errors: FieldErrors = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  // A file goes as it is; anything else as JSON. Fastify refuses an empty
  // body sent as JSON, so the header goes only with a body.
  const file = body instanceof Blob;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers:
        body === undefined
          ? {}
          : {
              "content-type": file
                ? "application/octet-stream"
                : "application/json",
            },
      body: body === undefined ? undefined : file ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Is it running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = data.errors ?? {};
    throw new ApiError(
      res.status,
      Object.keys(fields).length > 0
        ? "Check the highlighted fields."
        : (data.error ?? "Something went wrong. Try again."),
      fields,
    );
  }
  return data as T;
}

const ACCOUNTS = ["accounts"];
const REVIEW = ["review"];

/** Every account, archived ones included, in the order they were added. */
export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS,
    queryFn: () =>
      request<{ accounts: Account[] }>("GET", "/api/accounts").then(
        (data) => data.accounts,
      ),
  });
}

function useAccountChange<V, R = Account>(change: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    // Imports, exclusions and balances change what waits in Review too.
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export const useCreateAccount = () =>
  useAccountChange((body: AccountFields & { anchor?: AnchorFields }) =>
    request<Account>("POST", "/api/accounts", body),
  );

export const useUpdateAccount = (id: number) =>
  useAccountChange((body: AccountFields) =>
    request<Account>("PATCH", `/api/accounts/${id}`, body),
  );

export const useSetBalance = (id: number) =>
  useAccountChange((body: AnchorFields) =>
    request<Account>("PUT", `/api/accounts/${id}/anchor`, body),
  );

/** D2, "Look for what's missing": keeps the balance to compare with. */
export const useAddCheck = (id: number) =>
  useAccountChange((body: AnchorFields) =>
    request<BalanceCheck>("POST", `/api/accounts/${id}/balance-checks`, body),
  );

export const useRemoveCheck = () =>
  useAccountChange((id: number) =>
    request<null>("DELETE", `/api/balance-checks/${id}`),
  );

export const useArchive = (id: number) =>
  useAccountChange((archive: boolean) =>
    request<Account>(
      "POST",
      `/api/accounts/${id}/${archive ? "archive" : "unarchive"}`,
    ),
  );

/** A statement read by the server, waiting for the import's next steps. */
export interface UploadedFile {
  id: string;
  fileName: string;
  columns: string[];
  rowCount: number;
  /** The first rows, for S8's samples and preview. */
  sample: TableRow[];
  /** The saved format with the same columns, if there is one. */
  preset: { id: number; name: string; mapping: Mapping } | null;
}

/** S7: sends a file to read for an import into an account. */
export const useUpload = () =>
  useMutation({
    mutationFn: ({ account, file }: { account: number; file: File }) =>
      request<UploadedFile>(
        "POST",
        `/api/imports?account=${account}&file=${encodeURIComponent(file.name)}`,
        file,
      ),
  });

/** S9: what the import would do with a mapping. */
export interface ImportPreview {
  rows: PlannedRow[];
  unreadable: RowError[];
  leftOut: LeftOutRow[];
  /** No anchor yet and no balances in the file: I enter the balance. */
  needsBalance: boolean;
  anchor: Anchor | null;
  gaps: PlanGap[] | null;
}

/** S10: what the import did. */
export interface ImportResult {
  importId: number;
  imported: number;
  /** Imported ones linked as one side of a transfer. */
  linked: number;
  /** Imported ones that may be a transfer, whose other side I pick. */
  toPick: number;
  /** Imported ones the rules gave a category. */
  categorized: number;
  /** Imported ones the rules disagree on. */
  conflicts: number;
  skipped: number;
  unreadable: number;
  leftOut: number;
  anchor: Anchor | null;
  gaps: PlanGap[] | null;
}

export const usePreview = (upload: string, mapping: Mapping) =>
  useQuery({
    queryKey: ["import-preview", upload, mapping],
    queryFn: () =>
      request<ImportPreview>("POST", `/api/imports/${upload}/preview`, {
        mapping,
      }),
    // The file doesn't change while it's open; a failed preview won't either.
    staleTime: Infinity,
    retry: false,
  });

export const useSaveImport = (upload: string) =>
  useAccountChange(
    (body: {
      mapping: Mapping;
      decisions: Record<number, Decision>;
      balance?: AnchorFields;
      presetName: string | null;
    }) => request<ImportResult>("POST", `/api/imports/${upload}/save`, body),
  );

/** A transaction as the lists show it (S4, S5), and the panel (S6). */
export interface ListedTransaction {
  id: number;
  date: string;
  time: string | null;
  amount: number;
  description: string;
  reference: string | null;
  excluded: boolean;
  /** Kept although the import flagged it as a near-match of this one. */
  nearMatchOf: number | null;
  /** Null while it's uncategorized. */
  categoryId: number | null;
  /** The rule that gave its category; null when I picked it. */
  ruleId: number | null;
  /** While it's uncategorized: the categories its rules disagree on. */
  conflict: number[] | null;
  /** A possible transfer: how many could be its other side, and where. */
  toPick: { count: number; accountIds: number[] } | null;
  /** The other side, when it's a transfer. */
  transfer: TransferSide | null;
  /**
   * A payment: how many expenses it pays back, and how much of it that
   * takes. An expense: how many paybacks it has, and what they add up to.
   */
  paybacks: { count: number; total: number } | null;
  /** A possible payback: how many expenses it could pay back. */
  possiblePayback: number | null;
}

/** S4: one of the account's transactions, with the balance after it. */
export interface LedgerTransaction extends ListedTransaction {
  /** The bank's balance after it, if its file had one. */
  bankBalance: number | null;
  /** Null when it's excluded. */
  balance: number | null;
}

/** The other side of a transfer, in another account. */
export interface TransferSide {
  id: number;
  accountId: number;
  date: string;
  time: string | null;
  amount: number;
  description: string;
}

export interface LedgerGap {
  after: string;
  until: string;
  amount: number;
  suspects: {
    reason: SuspectReason;
    id: number;
    date: string;
    time: string | null;
    amount: number;
    description: string;
  }[];
}

/** A balance I entered to look for what's missing. */
export interface BalanceCheck {
  id: number;
  date: string;
  amount: number;
}

export interface AccountLedger {
  /** Newest first. */
  transactions: LedgerTransaction[];
  gaps: LedgerGap[];
  /** Days whose bank balance differs from the app's. */
  offDays: string[];
  /** Newest first, each with the app's balance that day. */
  checks: (BalanceCheck & { app: number })[];
}

export const useLedger = (account: number, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...ACCOUNTS, account, "transactions"],
    queryFn: () =>
      request<AccountLedger>("GET", `/api/accounts/${account}/transactions`),
  });

/** A transaction in any account (S5). */
export type FoundTransaction = ListedTransaction & { accountId: number };

/** S5: the transactions that pass the filters, in any account. */
export interface FoundTransactions {
  /** Newest first: the first `limit` of them. */
  transactions: FoundTransaction[];
  /** How many pass in all. */
  total: number;
  /** The months that have transactions, newest first: "2026-10". */
  months: string[];
}

// Under the accounts, so that what changes an account's list changes this too.
export const useTransactions = (filters: Filters, limit: number) =>
  useQuery({
    queryKey: [...ACCOUNTS, "transactions", filters, limit],
    queryFn: () => {
      const query = new URLSearchParams({ q: filters.q, limit: String(limit) });
      if (filters.accountId !== null) {
        query.set("account", String(filters.accountId));
      }
      if (filters.currency) query.set("currency", filters.currency);
      if (filters.period) query.set("period", writePeriod(filters.period));
      if (filters.categoryId !== null) {
        query.set("category", String(filters.categoryId));
      }
      if (filters.type) query.set("type", filters.type);
      return request<FoundTransactions>("GET", `/api/transactions?${query}`);
    },
    // Load more and new filters keep the rows until the new ones come.
    placeholderData: keepPreviousData,
  });

/** S6 over S5: the open transaction, even once a filter leaves it out. */
export const useTransaction = (id: number | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...ACCOUNTS, "transaction", id],
    queryFn: () => request<FoundTransaction>("GET", `/api/transactions/${id}`),
  });

/** A transaction a report names. */
export interface NamedTransaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  description: string;
}

/** S12: one month in one currency, and the 12 months up to it. */
export interface MonthlyReport {
  /** EUR first. */
  currencies: string[];
  currency: string;
  /** "2026-10". */
  month: string;
  /** Today's month: the one that's still going. */
  thisMonth: string;
  /** The oldest month with transactions in this currency. */
  first: string | null;
  income: ReportSide;
  expenses: ReportSide;
  net: number;
  /** Net ÷ income; null without income. */
  savingsRate: number | null;
  movedToSavings: {
    total: number;
    /** Positive into savings. */
    transfers: {
      amount: number;
      savings: NamedTransaction;
      other: NamedTransaction;
    }[];
  };
  /** The possible transfers left out until I decide. */
  pending: NamedTransaction[];
  /** The possible paybacks left out until I decide. */
  paybacks: NamedTransaction[];
  /** How many of the month's transactions Review can still change. */
  waiting: number;
  /** Oldest first, ending with this month. */
  months: { month: string; income: number; expenses: number }[];
}

// Under the accounts, so that what changes a transaction changes this too.
export const useMonthlyReport = (query: {
  currency: string | null;
  month: string | null;
}) =>
  useQuery({
    queryKey: [...ACCOUNTS, "report", "monthly", query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.currency) params.set("currency", query.currency);
      if (query.month) params.set("month", query.month);
      return request<MonthlyReport>("GET", `/api/reports/monthly?${params}`);
    },
    // Another month keeps the last one on screen until it comes.
    placeholderData: keepPreviousData,
  });

/** S13: spending by category over whole months, in one currency. */
export interface SpendingReport {
  /** EUR first. */
  currencies: string[];
  currency: string;
  period: Period;
  /** Today's month: the one that's still going. */
  thisMonth: string;
  /** The oldest and the newest month with transactions in this currency. */
  first: string | null;
  last: string | null;
  /** The periods on offer, by name. */
  choices: PeriodChoice[];
  /** The largest first, Uncategorized last. */
  lines: SpendingLine[];
  total: number;
  /** The categories that got more back than they spent, not counted. */
  refunded: ReportLine[];
  /** The possible transfers going out, left out until I decide. */
  pending: NamedTransaction[];
  /** The possible paybacks left out until I decide: they may lower it. */
  paybacks: NamedTransaction[];
  /** How many of the period's transactions Review can still change. */
  waiting: number;
}

export const useSpendingReport = (
  query: {
    currency: string | null;
    period: Period | null;
  },
  enabled = true,
) =>
  useQuery({
    queryKey: [...ACCOUNTS, "report", "spending", query],
    enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.currency) params.set("currency", query.currency);
      if (query.period) params.set("period", writePeriod(query.period));
      return request<SpendingReport>("GET", `/api/reports/spending?${params}`);
    },
    // Another period keeps the last one on screen until it comes.
    placeholderData: keepPreviousData,
  });

/** S14: a budget in the month the list is for. */
export interface BudgetRow {
  id: number;
  categoryId: number;
  /** The category's. */
  name: string;
  currency: string;
  start: string;
  /** The limit that month; before the budget starts, its first. */
  limit: number;
  /** Null before it starts. */
  status: BudgetStatus | null;
}

export interface BudgetList {
  /** EUR first. */
  currencies: string[];
  currency: string;
  month: string;
  /** Today's month: the one that's still going. */
  thisMonth: string;
  /** By category name. */
  budgets: BudgetRow[];
  /** What that month spent with no category: no budget counts it. */
  uncategorized: number;
  /** D7: the expense categories without a budget, by name. */
  available: { id: number; name: string }[];
  /** The oldest month with transactions in each currency. */
  firstMonths: Record<string, string | null>;
}

/** S15: a budget month by month, and what D7 answers. */
export interface Budget {
  id: number;
  categoryId: number;
  name: string;
  currency: string;
  plan: BudgetPlan;
  /** The newest month with transactions in its currency. */
  month: string;
  thisMonth: string;
  status: BudgetStatus | null;
  /** Oldest first, up to `month`. */
  history: BudgetMonth[];
}

// Under the accounts, so that what changes a transaction changes these too.
const BUDGETS = [...ACCOUNTS, "budgets"];

export const useBudgets = (query: {
  currency: string | null;
  month: string | null;
}) =>
  useQuery({
    queryKey: [...BUDGETS, query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.currency) params.set("currency", query.currency);
      if (query.month) params.set("month", query.month);
      return request<BudgetList>("GET", `/api/budgets?${params}`);
    },
    // Another month keeps the last one on screen until it comes.
    placeholderData: keepPreviousData,
  });

export const useBudget = (id: number, enabled = true) =>
  useQuery({
    queryKey: [...BUDGETS, id],
    queryFn: () => request<Budget>("GET", `/api/budgets/${id}`),
    enabled,
  });

function useBudgetChange<V>(change: (vars: V) => Promise<Budget>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () => client.invalidateQueries({ queryKey: BUDGETS }),
  });
}

export const useAddBudget = () =>
  useBudgetChange((body: BudgetFields) =>
    request<Budget>("POST", "/api/budgets", body),
  );

/** D7: a new limit from a month on. */
export const useChangeLimit = (id: number) =>
  useBudgetChange((body: { limit: string; from: string }) =>
    request<Budget>("POST", `/api/budgets/${id}/limits`, body),
  );

/** D7: the running balance counts again from a month. */
export const useStartOver = (id: number) =>
  useBudgetChange((body: { from: string }) =>
    request<Budget>("POST", `/api/budgets/${id}/restarts`, body),
  );

/** Excludes a transaction, or restores an excluded one. */
export const useExclude = () =>
  useAccountChange(({ id, excluded }: { id: number; excluded: boolean }) =>
    request<null>(
      "POST",
      `/api/transactions/${id}/${excluded ? "exclude" : "restore"}`,
    ),
  );

const CATEGORIES = ["categories"];
const RULES = ["rules"];

/** S16: every category, and how many counted transactions have none yet. */
export const useCategories = () =>
  useQuery({
    queryKey: CATEGORIES,
    queryFn: () =>
      request<{ categories: Category[]; uncategorized: number }>(
        "GET",
        "/api/categories",
      ),
  });

function useCategoryChange<V, R>(change: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () => client.invalidateQueries({ queryKey: CATEGORIES }),
  });
}

export const useCreateCategory = () =>
  useCategoryChange((body: CategoryFields) =>
    request<Category>("POST", "/api/categories", body),
  );

export const useUpdateCategory = (id: number) =>
  useCategoryChange((body: CategoryFields) =>
    request<Category>("PATCH", `/api/categories/${id}`, body),
  );

/**
 * D5, deleting. `moveTo` is where its transactions go, null to leave them
 * uncategorized; left out for a category nothing uses.
 */
export function useDeleteCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: number; moveTo?: number | null }) =>
      request<null>(
        "DELETE",
        `/api/categories/${id}`,
        moveTo === undefined ? undefined : { moveTo },
      ),
    // The transactions and rules it had change too.
    onSuccess: () =>
      Promise.all(
        [CATEGORIES, ACCOUNTS, RULES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** S6: sets a transaction's category, or takes it away (null). */
export function useSetCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      categoryId,
    }: {
      id: number;
      categoryId: number | null;
    }) =>
      request<null>("PUT", `/api/transactions/${id}/category`, { categoryId }),
    // A rule's count of the transactions it categorized can change too.
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, CATEGORIES, RULES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** S17: a rule, with what it did and the rules it overlaps. */
export interface RuleListItem extends Rule {
  /** How many transactions it categorized. */
  matches: number;
  /** The ids of the rules it overlaps. */
  overlaps: number[];
}

/** S17: every rule, oldest first, and the transactions the rules can't decide. */
export const useRules = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: RULES,
    queryFn: () =>
      request<{ rules: RuleListItem[]; conflicts: number }>(
        "GET",
        "/api/rules",
      ),
  });

/** A rule's change shows in categories' counts, and can categorize transactions. */
function useRuleChange<V, R>(change: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () =>
      Promise.all(
        [RULES, CATEGORIES, ACCOUNTS, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** D6's offers, ticked: what to categorize when the rule is saved. */
export interface RuleSaveOptions {
  /** The uncategorized transactions it matches. */
  apply: boolean;
  /** Editing: the conflicts it no longer takes part in. */
  settle: boolean;
}

export const useCreateRule = () =>
  useRuleChange((body: RuleFields & RuleSaveOptions) =>
    request<Rule>("POST", "/api/rules", body),
  );

export const useUpdateRule = (id: number) =>
  useRuleChange((body: RuleFields & RuleSaveOptions) =>
    request<Rule>("PATCH", `/api/rules/${id}`, body),
  );

export const useDeleteRule = () =>
  useRuleChange((id: number) => request<null>("DELETE", `/api/rules/${id}`));

/** D6: what saving the rule as typed would do. */
export type RulePreview =
  | { valid: false }
  | {
      valid: true;
      /** Uncategorized transactions it would give its category. */
      matching: number;
      /** Uncategorized ones it matches that another rule disagrees on. */
      conflicts: number;
      /** Editing: the conflicts it leaves that would get a category. */
      settled: { categoryId: number; count: number }[];
      /** The ids of the rules it would overlap. */
      overlaps: number[];
    };

/** `id` is the rule being edited; null for a new one. */
export const useRulePreview = (fields: RuleFields, id: number | null) =>
  useQuery({
    queryKey: [...RULES, "preview", id, fields],
    queryFn: () =>
      request<RulePreview>("POST", "/api/rules/preview", { ...fields, id }),
    // Keeps the last answer on screen while typing.
    placeholderData: keepPreviousData,
  });

/** S2: the transactions waiting for a category, and how many items wait. */
/** S2: a place where an account's balances and the bank's part ways. */
export interface ReviewMismatch {
  accountId: number;
  currency: string;
  /** Its place among the account's gaps, as S4 lists them. */
  index: number;
  after: string;
  until: string;
  amount: number;
  balances: { after: BothBalances; until: BothBalances };
}

/** S2: a possible transfer, with the transactions that could be its other side. */
export interface ReviewTransfer extends ReviewTarget {
  candidates: TransferSide[];
}

/** S2: a pair across currencies that could be an exchange, from the side going out. */
export interface ReviewExchange extends ReviewTarget {
  other: TransferSide;
}

/** S2: money in that may pay back expenses, with those it could pay back. */
export interface ReviewPayback extends ReviewTarget {
  expenses: (PaybackSide & { left: number })[];
}

export type ReviewList = ReviewGroups<ReviewTarget> & {
  paybacks: ReviewPayback[];
  transfers: ReviewTransfer[];
  exchanges: ReviewExchange[];
  mismatches: ReviewMismatch[];
  count: number;
};

export const useReview = () =>
  useQuery({
    queryKey: REVIEW,
    queryFn: () => request<ReviewList>("GET", "/api/review"),
  });

/** S2, Use it: gives a transaction the category its rules agree on. */
export function useApplyRules() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<Suggestion>("POST", `/api/transactions/${id}/apply-rules`),
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, CATEGORIES, RULES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** S6: unlinks a transfer for good; both sides become uncategorized. */
export function useUnlink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      request<null>("POST", `/api/transactions/${id}/unlink`),
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, CATEGORIES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** What linking or Not a transfer changed, for Undo to put back. */
export interface TransferChange {
  linked: [number, number][];
  dismissed: [number, number][];
  before: { id: number; categoryId: number | null; ruleId: number | null }[];
}

/**
 * D4: what a transaction can be linked with by hand. Its own key, so that
 * linking doesn't fetch it again while the dialog closes: by then the
 * transaction is linked, and has no options.
 */
export const useLinkOptions = (id: number) =>
  useQuery({
    queryKey: ["link-options", id],
    retry: false,
    queryFn: () =>
      request<{ window: number; options: TransferSide[] }>(
        "GET",
        `/api/transactions/${id}/link-options`,
      ),
  });

/** Linking, Not a transfer and their Undo change categories and Review too. */
function useTransferChange<V, R>(change: (vars: V) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, CATEGORIES, RULES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** The other side of a payback link: an expense, or a payment. */
export interface PaybackSide extends TransferSide {
  categoryId: number | null;
}

/** S6: a transaction's payback links, newest first. */
export const usePaybacks = (id: number, enabled: boolean) =>
  useQuery({
    queryKey: [...ACCOUNTS, "transaction", id, "paybacks"],
    enabled,
    queryFn: () =>
      request<{
        total: number;
        links: { amount: number; other: PaybackSide }[];
      }>("GET", `/api/transactions/${id}/paybacks`),
  });

/** D9: another side it offers. */
export interface PaybackOption extends PaybackSide {
  /** What's left of it to link with this transaction. */
  left: number;
  /** What it's linked with this transaction now. */
  linked: number;
}

/**
 * D9: what a payment could pay back, or what could pay an expense back;
 * with `search`, the older expenses or later payments found. Its own key,
 * like D4's, and dropped once D9 closes: D9 starts from the split the
 * transaction has when it opens, never from an earlier one.
 */
export const usePaybackOptions = (id: number, search?: string) =>
  useQuery({
    queryKey: ["payback-options", id, search ?? null],
    gcTime: 0,
    retry: false,
    enabled: search === undefined || search.trim() !== "",
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<{ window: number; options: PaybackOption[] }>(
        "GET",
        `/api/transactions/${id}/payback-options` +
          (search === undefined ? "" : `?q=${encodeURIComponent(search)}`),
      ),
  });

/**
 * D9 and Unlink change lists, reports and Review; unlinking can link a
 * transfer on its own, which changes categories and rules too.
 */
function usePaybackChange<V>(change: (vars: V) => Promise<null>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: () =>
      Promise.all(
        [ACCOUNTS, CATEGORIES, RULES, REVIEW].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** D9, Link payback: the split as typed, replacing the one it had. */
export const useSetPaybacks = () =>
  usePaybackChange(
    ({ id, links }: { id: number; links: { id: number; amount: string }[] }) =>
      request<null>("PUT", `/api/transactions/${id}/paybacks`, { links }),
  );

/**
 * S2 and S6, It's income: a possible payback gets its category and isn't
 * suggested again; Undo makes it a possible payback again.
 */
export const useNotAPayback = () =>
  usePaybackChange(({ id, categoryId }: { id: number; categoryId: number }) =>
    request<null>("POST", `/api/transactions/${id}/not-a-payback`, {
      categoryId,
    }),
  );
export const useUndoNotAPayback = () =>
  usePaybackChange((id: number) =>
    request<null>("DELETE", `/api/transactions/${id}/not-a-payback`),
  );

/** S6, Unlink: takes away a payment's links, or an expense's paybacks. */
export const useUnlinkPaybacks = () =>
  usePaybackChange((id: number) =>
    request<null>("DELETE", `/api/transactions/${id}/paybacks`),
  );

export const useLink = () =>
  useTransferChange(({ id, otherId }: { id: number; otherId: number }) =>
    request<TransferChange>("POST", `/api/transactions/${id}/link`, {
      otherId,
    }),
  );

/** None of its candidates is its other side; with `otherId`, only that one. */
export const useNotATransfer = () =>
  useTransferChange(({ id, otherId }: { id: number; otherId?: number }) =>
    request<TransferChange>(
      "POST",
      `/api/transactions/${id}/not-a-transfer`,
      otherId === undefined ? undefined : { otherId },
    ),
  );

export const useUndoTransfer = () =>
  useTransferChange((change: TransferChange) =>
    request<null>("POST", "/api/transfers/undo", change),
  );

const SETTINGS = ["settings"];

/** S18. */
export const useSettings = () =>
  useQuery({
    queryKey: SETTINGS,
    queryFn: () =>
      request<{ transferWindow: number; lastBackup: string | null }>(
        "GET",
        "/api/settings",
      ),
  });

/** A new transfer window links what it brings in, so everything may change. */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { transferWindow: string }) =>
      request<{ transferWindow: number; linked: number }>(
        "PATCH",
        "/api/settings",
        body,
      ),
    onSuccess: () => client.invalidateQueries(),
  });
}

/** S18: saves all data as one file. The server remembers the day. */
export function useDownloadBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      let res: Response;
      try {
        res = await fetch("/api/backup");
      } catch {
        throw new ApiError(0, "Can't reach the server. Is it running?");
      }
      if (!res.ok) {
        throw new ApiError(res.status, "Something went wrong. Try again.");
      }
      const name =
        /filename="(.+)"/.exec(
          res.headers.get("content-disposition") ?? "",
        )?.[1] ?? "bean-counter-backup.db";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: SETTINGS }),
  });
}

/** D8: all data is replaced, so everything is fetched again. */
export function useRestore() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => request<null>("POST", "/api/restore", file),
    onSuccess: () => client.invalidateQueries(),
  });
}
