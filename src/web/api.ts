import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account,
  AccountFields,
  Anchor,
  AnchorFields,
  FieldErrors,
} from "../domain/accounts.ts";
import type { SuspectReason } from "../domain/balances.ts";
import type { Category, CategoryFields } from "../domain/categories.ts";
import type {
  LeftOutRow,
  Mapping,
  RowError,
} from "../domain/import/mapping.ts";
import type { Decision, PlanGap, PlannedRow } from "../domain/import/plan.ts";
import type { TableRow } from "../domain/import/table.ts";

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
    onSuccess: () => client.invalidateQueries({ queryKey: ACCOUNTS }),
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

/** S4: one of the account's transactions, with the balance after it. */
export interface LedgerTransaction {
  id: number;
  date: string;
  time: string | null;
  amount: number;
  description: string;
  reference: string | null;
  /** The bank's balance after it, if its file had one. */
  bankBalance: number | null;
  excluded: boolean;
  /** Kept although the import flagged it as a near-match of this one. */
  nearMatchOf: number | null;
  /** Null when it's excluded. */
  balance: number | null;
}

export interface LedgerGap {
  after: string;
  until: string;
  amount: number;
  suspects: {
    reason: SuspectReason;
    id: number;
    date: string;
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

/** Excludes a transaction, or restores an excluded one. */
export const useExclude = () =>
  useAccountChange(({ id, excluded }: { id: number; excluded: boolean }) =>
    request<null>(
      "POST",
      `/api/transactions/${id}/${excluded ? "exclude" : "restore"}`,
    ),
  );

const CATEGORIES = ["categories"];

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

export const useDeleteCategory = () =>
  useCategoryChange((id: number) =>
    request<null>("DELETE", `/api/categories/${id}`),
  );
