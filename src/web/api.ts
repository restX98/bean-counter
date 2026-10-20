import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Account,
  AccountFields,
  AnchorFields,
  FieldErrors,
} from "../domain/accounts.ts";
import type { Mapping } from "../domain/import/mapping.ts";
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

function useAccountChange<V>(change: (vars: V) => Promise<Account>) {
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
