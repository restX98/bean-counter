import { useId, useState } from "react";
import { useSettings, useUpdateSettings } from "../api.ts";
import { fieldErrors, FormError } from "../components/Dialog.tsx";
import { describedBy, Field } from "../components/Field.tsx";
import { Loading, Page } from "../components/Page.tsx";
import { plural } from "../labels.ts";

const HINT =
  "How many days apart the two sides of a transfer can be. Default 3, which covers a weekend.";

/**
 * S18, its Transfers section for now. The window saves when I leave the
 * field or press Enter.
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
