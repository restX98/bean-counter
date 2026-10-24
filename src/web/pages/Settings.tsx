import { useId, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import { useDownloadBackup, useSettings, useUpdateSettings } from "../api.ts";
import { fieldErrors, FormError } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { RestoreBackup } from "../dialogs/RestoreBackup.tsx";
import { plural } from "../labels.ts";

const HINT =
  "How many days apart the two sides of a transfer can be. Default 3, which covers a weekend.";

/**
 * S18, its Transfers and Backup & restore sections for now. The window
 * saves when I leave the field or press Enter.
 */
export function Settings() {
  const page = {
    title: "Settings",
    back: { to: "/more", label: "Back to More" },
  };
  const settings = useSettings();
  if (!settings.data) {
    return (
      <Page {...page}>
        <Loading error={settings.error} />
      </Page>
    );
  }
  return (
    <Page {...page}>
      <TransferWindow saved={settings.data.transferWindow} />
      <Backup last={settings.data.lastBackup} />
    </Page>
  );
}

function TransferWindow({ saved }: { saved: number }) {
  const id = useId();
  const update = useUpdateSettings();
  const [text, setText] = useState(String(saved));
  const error = fieldErrors(update.error).transferWindow;

  const save = () => {
    if (text.trim() !== String(saved) || error) {
      update.mutate({ transferWindow: text });
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">Transfers</h2>
      <FormError error={update.error} />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          id={`${id}-window`}
          label="Transfer window"
          error={error}
          hint={HINT}
        >
          <span className="input suffix">
            <input
              id={`${id}-window`}
              inputMode="numeric"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={save}
              {...describedBy(`${id}-window`, error, HINT)}
            />
            <span className="muted">days</span>
          </span>
        </Field>
      </form>
      {update.data && !update.isPending && !error && (
        <p className="caption" role="status">
          Saved: the two sides can be{" "}
          {plural(update.data.transferWindow, "day")} apart.
          {update.data.linked > 0 &&
            ` ${plural(update.data.linked, "more transfer")} linked.`}
        </p>
      )}
    </section>
  );
}

/** Restore from file… picks the file first, then D8 asks to confirm. */
function Backup({ last }: { last: string | null }) {
  const download = useDownloadBackup();
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  return (
    <section className="card">
      <h2 className="card-title">Backup &amp; restore</h2>
      <p className="muted">
        A backup is one file with all your data: accounts, transactions,
        categories, rules, budgets, presets and settings.
      </p>
      <FormError error={download.error} />
      <div className="m-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          <Icon name="import" />
          Download backup
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => picker.current?.click()}
        >
          Restore from file…
        </button>
      </div>
      <input
        ref={picker}
        type="file"
        accept=".db"
        hidden
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) setFile(chosen);
          // So picking the same file again still counts as a change.
          e.target.value = "";
        }}
      />
      <p className="caption">
        {last
          ? `Last backup downloaded: ${formatDate(last)}.`
          : "No backup downloaded yet."}{" "}
        Restoring replaces all current data.
      </p>
      {file && (
        <RestoreBackup
          file={file}
          onChange={() => picker.current?.click()}
          onClose={() => setFile(null)}
        />
      )}
    </section>
  );
}
