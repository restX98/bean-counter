import { useId, useRef, useState, type DragEvent } from "react";
import type { Account } from "../../../domain/accounts.ts";
import { ApiError, type UploadedFile } from "../../api.ts";
import { FormError } from "../../components/Dialog.tsx";
import { describedBy, Field } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { plural } from "../../labels.ts";
import { useIsMobile } from "../../useIsMobile.ts";

interface Props {
  /** The active accounts; there's at least one. */
  accounts: Account[];
  account: Account;
  onAccount: (account: Account) => void;
  /** Opens D1, for a statement of an account not added yet. */
  onAddAccount: () => void;
  file: File | null;
  onFile: (file: File | null) => void;
  /** The file as the server read it, once it has. */
  uploaded: UploadedFile | undefined;
  reading: boolean;
  error: Error | null;
}

/** S7: the account to import into and the statement file. */
export function ChooseFile({
  accounts,
  account,
  onAccount,
  onAddAccount,
  file,
  onFile,
  uploaded,
  reading,
  error,
}: Props) {
  const id = useId();
  const isMobile = useIsMobile();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // A file the server couldn't read answers 400; other errors aren't the file's.
  const unreadable = error instanceof ApiError && error.status === 400;

  const addHint = (
    <>
      Not in the list?{" "}
      <button type="button" className="link" onClick={onAddAccount}>
        Add an account
      </button>
    </>
  );

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div className="narrow">
      <Field id={`${id}-account`} label="Account" hint={addHint}>
        <span className="select-wrap">
          <select
            id={`${id}-account`}
            className="select"
            value={account.id}
            onChange={(e) =>
              onAccount(accounts.find((a) => a.id === Number(e.target.value))!)
            }
            {...describedBy(`${id}-account`, undefined, addHint)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.bank} · {a.currency}
              </option>
            ))}
          </select>
          <Icon name="chevron" />
        </span>
      </Field>

      <div className="field">
        <span className="label" id={`${id}-file`}>
          Statement file
        </span>
        <div
          className={dragging ? "dropzone is-dragging" : "dropzone"}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <Icon name="import" />
          {isMobile ? (
            <strong>Choose a CSV or Excel file</strong>
          ) : (
            <>
              <strong>Drop a CSV or Excel file here</strong>
              <span className="muted">or</span>
            </>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            aria-describedby={`${id}-file`}
            onClick={() => input.current?.click()}
          >
            Browse files
          </button>
          <span className="caption">Supported: .csv, .xlsx</span>
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        {file && (
          <div className={unreadable ? "file-row is-error" : "file-row"}>
            <Icon name="file" />
            <span className="name">
              <strong>{file.name}</strong>
              {reading ? (
                <span className="caption">Reading…</span>
              ) : unreadable ? (
                <span className="tag tone-danger">Can't read</span>
              ) : (
                uploaded && (
                  <span className="caption">
                    {plural(uploaded.rowCount, "row")}
                  </span>
                )
              )}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onFile(null)}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {file && !reading && unreadable && (
        <div className="banner tone-danger" role="alert">
          <Icon name="alert" />
          <span className="text">
            <strong>Can't read “{file.name}”</strong>
            {error.message}
          </span>
        </div>
      )}
      {file && !reading && !unreadable && <FormError error={error} />}
      {file && !reading && uploaded && <Recognised uploaded={uploaded} />}
    </div>
  );
}

function Recognised({ uploaded: { preset } }: { uploaded: UploadedFile }) {
  if (!preset) {
    return (
      <div className="banner tone-info">
        <Icon name="info" />
        <span className="text">
          <strong>New format</strong>
          No saved preset matches this file. You'll map its columns in the next
          step, once for this format.
        </span>
      </div>
    );
  }
  return (
    <div className="banner tone-success">
      <Icon name="check" />
      <span className="text">
        <strong>Format recognised: {preset.name}</strong>
        The columns match this saved preset, so the mapping step is skipped.
        {preset.mapping.roles.includes("balance") &&
          " This export has a balance column: the balance check runs after the import."}
      </span>
    </div>
  );
}
