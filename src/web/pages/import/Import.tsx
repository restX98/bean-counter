import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Account } from "../../../domain/accounts.ts";
import {
  guessMapping,
  toMapping,
  type MappingDraft,
} from "../../../domain/import/guess.ts";
import { checkMapping, type Mapping } from "../../../domain/import/mapping.ts";
import { useAccounts, useUpload, type UploadedFile } from "../../api.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Loading } from "../../components/Page.tsx";
import { AccountForm } from "../../dialogs/AccountForm.tsx";
import { TYPE_LABELS } from "../../labels.ts";
import { ChooseFile } from "./ChooseFile.tsx";
import { Flow } from "./Flow.tsx";
import { isReadable, MapColumns, readSample } from "./MapColumns.tsx";

type Step = "file" | "columns" | "preview";

/**
 * The import, S7 to S10, on one page: its state lives here until it's
 * saved, and leaving the page drops it.
 */
export function Import() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = Number(params.get("account")) || null;
  const { data: accounts, error } = useAccounts();
  const upload = useUpload();
  const [chosen, setChosen] = useState(from);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("file");
  // Kept per set of columns, so going back and forth keeps my changes.
  const [draft, setDraft] = useState<{ key: string; draft: MappingDraft }>();
  const [mapping, setMapping] = useState<Mapping>();
  const [savePreset, setSavePreset] = useState(true);
  // Adding an account from S7, possibly for a currency the file is in.
  const [adding, setAdding] = useState<{ currency?: string } | null>(null);

  const close = () => navigate(from ? `/accounts/${from}` : "/");
  const cancel = (
    <button type="button" className="btn btn-secondary" onClick={close}>
      Cancel
    </button>
  );
  const button = (label: string, onClick?: () => void, primary = true) => (
    <button
      type="button"
      className={primary ? "btn btn-primary" : "btn btn-secondary"}
      disabled={!onClick}
      onClick={onClick}
    >
      {label}
    </button>
  );

  if (!accounts) {
    return (
      <Flow step={1} onClose={close} back={cancel} next={button("Continue →")}>
        <Loading error={error} />
      </Flow>
    );
  }
  const active = accounts.filter((a) => !a.archivedOn);
  const account = active.find((a) => a.id === chosen) ?? active[0];

  if (!account) {
    return (
      <Flow step={1} onClose={close} back={cancel} next={button("Continue →")}>
        <div className="narrow">
          <EmptyState
            icon="wallet"
            title="No accounts yet"
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setAdding({})}
              >
                <Icon name="plus" />
                Add account
              </button>
            }
          >
            Statements are imported into an account. Add one first.
          </EmptyState>
        </div>
        {adding && (
          <AccountForm
            onClose={() => setAdding(null)}
            onSaved={(saved) => setChosen(saved.id)}
          />
        )}
      </Flow>
    );
  }

  const send = (to: Account, chosenFile: File | null) => {
    setFile(chosenFile);
    if (chosenFile) upload.mutate({ account: to.id, file: chosenFile });
    else upload.reset();
  };
  const uploaded = file && !upload.isPending ? upload.data : undefined;
  const presetName = `${account.bank} · ${TYPE_LABELS[account.type].toLowerCase()}`;

  if (step === "file" || !uploaded) {
    const toNext = () => {
      if (!uploaded) return;
      if (uploaded.preset) {
        setMapping(uploaded.preset.mapping);
        setStep("preview");
        return;
      }
      const key = uploaded.columns.join("\n");
      if (draft?.key !== key) {
        setDraft({
          key,
          draft: guessMapping(
            uploaded.columns,
            uploaded.sample.map((row) => row.cells),
            account.currency,
          ),
        });
      }
      setStep("columns");
    };
    return (
      <Flow
        step={1}
        onClose={close}
        back={cancel}
        next={button("Continue →", uploaded ? toNext : undefined)}
        hint={
          uploaded
            ? undefined
            : upload.isPending
              ? "Reading the file…"
              : "Choose a CSV or Excel file to continue."
        }
      >
        <ChooseFile
          accounts={active}
          account={account}
          onAccount={(to) => {
            setChosen(to.id);
            if (file) send(to, file);
          }}
          onAddAccount={(currency) => setAdding({ currency })}
          currencies={uploaded ? otherCurrencies(uploaded, account) : null}
          file={file}
          onFile={(chosenFile) => send(account, chosenFile)}
          uploaded={uploaded}
          reading={upload.isPending}
          error={upload.error}
        />
        {adding && (
          <AccountForm
            currency={adding.currency}
            onClose={() => setAdding(null)}
            onSaved={(saved) => {
              setChosen(saved.id);
              if (file) send(saved, file);
            }}
          />
        )}
      </Flow>
    );
  }

  const skipped = uploaded.preset ? [2] : [];
  if (step === "columns" && draft) {
    const mapped = toMapping(draft.draft);
    const problems = checkMapping(mapped);
    const readings = readSample(uploaded, mapped, account.currency);
    const ready = problems.length === 0 && readings.some(isReadable);
    return (
      <Flow
        step={2}
        onClose={close}
        back={button("← Back", () => setStep("file"), false)}
        next={button(
          "Continue →",
          ready
            ? () => {
                setMapping(mapped);
                setStep("preview");
              }
            : undefined,
        )}
        hint={
          problems.length > 0
            ? "Complete the mapping to continue."
            : ready
              ? undefined
              : "Check the date format and decimal separator to continue."
        }
      >
        <MapColumns
          file={uploaded}
          account={account}
          draft={draft.draft}
          onDraft={(changed) => setDraft({ ...draft, draft: changed })}
          problems={problems}
          readings={readings}
          presetName={presetName}
          savePreset={savePreset}
          onSavePreset={setSavePreset}
        />
      </Flow>
    );
  }

  // S9 and S10 come with the next slice.
  return (
    <Flow
      step={3}
      skipped={skipped}
      onClose={close}
      back={button(
        "← Back",
        () => setStep(uploaded.preset ? "file" : "columns"),
        false,
      )}
      next={button("Import")}
      hint="The preview comes in the next step of building the app."
    >
      <div className="narrow">
        <EmptyState icon="list" title="Preview not built yet">
          {mapping
            ? `${uploaded.fileName} is ready to preview with ${mapping.roles.filter((r) => r !== "ignore").length} mapped columns.`
            : "This step shows what the import will do."}
        </EmptyState>
      </div>
    </Flow>
  );
}

/**
 * The currencies in a file's first rows other than the account's, read with
 * the mapping S8 would start from. Null when there are none.
 */
function otherCurrencies(file: UploadedFile, account: Account) {
  const mapping =
    file.preset?.mapping ??
    toMapping(
      guessMapping(
        file.columns,
        file.sample.map((row) => row.cells),
        account.currency,
      ),
    );
  const readings = readSample(file, mapping, account.currency);
  const others = [
    ...new Set(
      readings.flatMap((r) =>
        r.leftOut?.reason === "currency" ? [r.leftOut.value] : [],
      ),
    ),
  ];
  const own = readings.some((r) => !r.leftOut && isReadable(r));
  return others.length > 0 ? { others, own } : null;
}
