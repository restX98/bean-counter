import { useState } from "react";
import { useNavigate } from "react-router";
import { formatDate, todayIso } from "../../domain/dates.ts";
import { useDownloadBackup, useRestore } from "../api.ts";
import { Dialog, FormError } from "../components/Dialog.tsx";
import { Icon } from "../components/Icon.tsx";

const MB = 1024 * 1024;

const fileSize = (bytes: number) =>
  bytes < MB
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / MB).toFixed(1)} MB`;

/**
 * D8: replacing all data with a backup's, after downloading the current data
 * if I keep the box ticked. If that download fails, nothing is replaced.
 * Afterwards I land on the dashboard.
 */
export function RestoreBackup({
  file,
  onChange,
  onClose,
}: {
  file: File;
  /** Pick another file. */
  onChange: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const download = useDownloadBackup();
  const restore = useRestore();
  const [backUpFirst, setBackUpFirst] = useState(true);

  const submit = async () => {
    try {
      if (backUpFirst) await download.mutateAsync();
      await restore.mutateAsync(file);
      navigate("/");
    } catch {
      // The dialog shows the error.
    }
  };

  return (
    <Dialog
      title="Restore from backup?"
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={download.isPending || restore.isPending}
          >
            Replace all data
          </button>
        </>
      }
    >
      <FormError error={download.error ?? restore.error} />
      <div className="banner tone-danger">
        <Icon name="alert" />
        <span className="text">
          <strong>This replaces all current data</strong>
          Accounts, transactions, categories, rules, budgets, presets and
          settings are replaced with the contents of the backup file. It can't
          be undone.
        </span>
      </div>
      <div className="file-row">
        <Icon name="file" />
        <span className="name">
          <strong>{file.name}</strong>
          <span className="caption">
            Made {formatDate(todayIso(new Date(file.lastModified)))} ·{" "}
            {fileSize(file.size)}
          </span>
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onChange}
        >
          Change
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          className="visually-hidden"
          checked={backUpFirst}
          onChange={(e) => setBackUpFirst(e.target.checked)}
        />
        <span className="box">{backUpFirst && <Icon name="check" />}</span>
        <span>Download a backup of the current data first</span>
      </label>
    </Dialog>
  );
}
