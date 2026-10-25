import { useId, useRef, useState } from "react";
import { formatDate } from "../../domain/dates.ts";
import {
  type Preset,
  useDownloadBackup,
  usePresets,
  useSettings,
  useUpdateSettings,
} from "../api.ts";
import { fieldErrors, FormError } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { DeletePreset } from "../dialogs/DeletePreset.tsx";
import { RestoreBackup } from "../dialogs/RestoreBackup.tsx";
import { plural } from "../labels.ts";
import { useIsMobile } from "../useIsMobile.ts";

const HINT =
  "How many days apart the two sides of a transfer can be. Default 3, which covers a weekend.";

/**
 * S18. The transfer window saves when I leave the field or press Enter.
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
      <Presets />
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

const format = (preset: Preset) =>
  `${plural(preset.columns, "column")}, ${preset.balance ? "with" : "no"} balance`;

/**
 * The saved export formats, each with Delete. On mobile a preset opens its
 * Delete confirmation, for now.
 */
function Presets() {
  const isMobile = useIsMobile();
  const { data, error } = usePresets();
  const [deleting, setDeleting] = useState<Preset | null>(null);

  let list;
  if (!data) {
    list = <Loading error={error} />;
  } else if (data.presets.length === 0) {
    list = (
      <p className="caption">
        No presets yet. Importing a file saves its format here.
      </p>
    );
  } else if (isMobile) {
    list = (
      <div className="card m-list inner">
        {data.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="m-tx"
            onClick={() => setDeleting(preset)}
          >
            <span className="desc">{preset.name}</span>
            <span className="amount muted">
              {preset.lastUsed ? formatDate(preset.lastUsed).slice(0, 5) : "—"}
            </span>
            <span className="meta">
              {[format(preset), preset.accounts.join(", ")]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        ))}
      </div>
    );
  } else {
    list = (
      <div className="card table inner">
        <div className="preset-row head" aria-hidden="true">
          <span>Preset</span>
          <span>Format</span>
          <span>Used for</span>
          <span>Last used</span>
          <span />
        </div>
        {data.presets.map((preset) => (
          <div key={preset.id} className="preset-row">
            <span className="name">{preset.name}</span>
            <span className="muted-cell">{format(preset)}</span>
            <span>{preset.accounts.join(", ") || "—"}</span>
            <span className="muted-cell">
              {preset.lastUsed ? formatDate(preset.lastUsed) : "—"}
            </span>
            <span className="acts">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Delete preset ${preset.name}`}
                onClick={() => setDeleting(preset)}
              >
                Delete
              </button>
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="card">
      <h2 className="card-title">Import presets</h2>
      <p className="muted">
        One preset per export format. When you import a file, the app uses the
        preset whose columns match it.
      </p>
      {list}
      {deleting && (
        <DeletePreset preset={deleting} onClose={() => setDeleting(null)} />
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
