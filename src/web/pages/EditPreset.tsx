import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatDate } from "../../domain/dates.ts";
import { toMapping, type MappingDraft } from "../../domain/import/guess.ts";
import { checkMapping } from "../../domain/import/mapping.ts";
import { type PresetDetail, usePreset, useUpdatePreset } from "../api.ts";
import { fieldErrors, FormError } from "../components/Dialog.tsx";
import { Field } from "../components/Field.tsx";
import { Icon } from "../components/Icon.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { DeletePreset } from "../dialogs/DeletePreset.tsx";
import { useIsMobile } from "../useIsMobile.ts";
import { isReadable, MapColumns, readSample } from "./import/MapColumns.tsx";

const SAMPLES_NOTE =
  "Samples come from the last file imported with this preset. Changes apply to future imports only; transactions already imported don't change.";

/** S8 opened from S18: a saved preset's mapping, without the import wizard. */
export function EditPreset() {
  const id = Number(useParams().id);
  const preset = usePreset(id);
  if (!preset.data) {
    return (
      <Page
        title="Edit preset"
        back={{ to: "/settings", label: "Back to Settings" }}
      >
        <Loading error={preset.error} />
      </Page>
    );
  }
  return <PresetForm preset={preset.data} />;
}

function PresetForm({ preset }: { preset: PresetDetail }) {
  const id = useId();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const update = useUpdatePreset(preset.id);
  const [name, setName] = useState(preset.name);
  const [draft, setDraft] = useState<MappingDraft>(preset.mapping);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    document.title = "Edit preset · Bean Counter";
  }, []);

  const close = () => navigate("/settings");
  const mapping = toMapping(draft);
  const problems = checkMapping(mapping);
  const readings = readSample(
    preset,
    mapping,
    preset.lastImport?.currency ?? "",
  );
  // Without samples there's nothing to read, so only the mapping is checked.
  const ready =
    problems.length === 0 &&
    (preset.sample.length === 0 || readings.some(isReadable));
  const hint =
    problems.length > 0
      ? "Complete the mapping to save."
      : ready
        ? undefined
        : "Check the date format and decimal separator to save.";
  const last = preset.lastImport;
  const lastUsed =
    last &&
    `Last used ${formatDate(last.importedOn)} with ${last.fileName} (${last.account})`;

  const save = () => update.mutate({ name, mapping }, { onSuccess: close });
  // On desktop, Cancel and Save go right, with the hint before them.
  const cancel = (
    <button
      type="button"
      className={hint ? "btn btn-secondary" : "btn btn-secondary push"}
      onClick={close}
    >
      Cancel
    </button>
  );
  const saveButton = (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!ready || update.isPending}
      onClick={save}
    >
      Save preset
    </button>
  );
  const deleteButton = (
    <button
      type="button"
      className="btn btn-ghost danger-link"
      onClick={() => setDeleting(true)}
    >
      Delete preset
    </button>
  );

  const fields = (
    <>
      <FormError error={update.error} />
      <div className="narrow">
        <Field
          id={`${id}-name`}
          label="Preset name"
          error={fieldErrors(update.error).name}
        >
          <input
            id={`${id}-name`}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </Field>
      </div>
      <MapColumns
        file={preset}
        currency={preset.lastImport?.currency ?? ""}
        draft={draft}
        onDraft={setDraft}
        problems={problems}
        readings={readings}
      />
      <p className="caption">{SAMPLES_NOTE}</p>
      {deleting && (
        <DeletePreset
          preset={preset}
          onClose={() => setDeleting(false)}
          onDeleted={close}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="m-flow">
        <header className="m-header">
          <button
            type="button"
            className="icon-btn back"
            aria-label="Close"
            onClick={close}
          >
            <Icon name="x" />
          </button>
          <h1>Edit preset</h1>
        </header>
        <div className="m-scroll">
          <div className="m-page">
            {lastUsed && <p className="muted">{lastUsed}</p>}
            {fields}
            {deleteButton}
          </div>
        </div>
        <div className="action-bar">
          {cancel}
          {saveButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flow">
      <div className="page">
        <div className="page-head">
          <div>
            <p className="crumb">
              <Link to="/settings">Settings</Link>
              <span>/</span>
              <span>Import presets</span>
              <span>/</span>
              <span>{preset.name}</span>
            </p>
            <h1>Edit preset</h1>
            {lastUsed && <p>{lastUsed}</p>}
          </div>
        </div>
        {fields}
      </div>
      <footer className="flow-foot">
        {deleteButton}
        {hint && <span className="hint push">{hint}</span>}
        {cancel}
        {saveButton}
      </footer>
    </div>
  );
}
