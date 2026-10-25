import { useId, useState } from "react";
import { formatWhen } from "../../../domain/dates.ts";
import type { MappingDraft } from "../../../domain/import/guess.ts";
import {
  readRow,
  ROLE_LABELS,
  type ColumnRole,
  type Mapping,
  type RowReading,
} from "../../../domain/import/mapping.ts";
import { cellText } from "../../../domain/import/table.ts";
import {
  DATE_FORMATS,
  type DateFormat,
  type DecimalMark,
} from "../../../domain/import/values.ts";
import { formatAmount } from "../../../domain/money.ts";
import type { UploadedFile } from "../../api.ts";
import { Field } from "../../components/Field.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useIsMobile } from "../../useIsMobile.ts";

/** Rows shown in the tables. */
const SAMPLES = 5;
const ONE_USE: ColumnRole[] = [
  "date",
  "amount",
  "debit",
  "credit",
  "fee",
  "balance",
  "reference",
  "currency",
  "status",
];
const DECIMAL_LABELS: Record<DecimalMark, string> = {
  point: "Point · 1,234.56",
  comma: "Comma · 1.234,56",
};

/** The file's first rows as a mapping reads them. */
export const readSample = (
  file: Pick<UploadedFile, "columns" | "sample">,
  mapping: Mapping,
  currency: string,
) =>
  file.sample.map((row) => ({
    line: row.line,
    ...readRow(file.columns, row.cells, mapping, currency),
  }));

export const isReadable = (row: RowReading) =>
  row.date !== null && row.amount !== null && row.problems.length === 0;

interface Props {
  /** The columns and first rows of a file, or of a preset's last file. */
  file: Pick<UploadedFile, "columns" | "sample">;
  /** The currency the preview's amounts are in. */
  currency: string;
  draft: MappingDraft;
  onDraft: (draft: MappingDraft) => void;
  /** What's missing or doubled; empty when the mapping is complete. */
  problems: string[];
  /** The first rows, read with the draft (see readSample). */
  readings: (RowReading & { line: number })[];
}

/**
 * S8's mapping: what each column of a format holds, with a preview of the
 * first rows. Used by the import and by a preset's edit page.
 */
export function MapColumns({
  file,
  currency,
  draft,
  onDraft,
  problems,
  readings,
}: Props) {
  const id = useId();
  const isMobile = useIsMobile();
  // One amount column, or a debit and a credit column: it decides the choices.
  const [split, setSplit] = useState(
    draft.roles.includes("debit") || draft.roles.includes("credit"),
  );
  const { columns } = file;
  const rows = file.sample.slice(0, SAMPLES);
  const roleChoices: ColumnRole[] = [
    "date",
    ...(split ? (["debit", "credit"] as const) : (["amount"] as const)),
    "fee",
    "description",
    "balance",
    "reference",
    "currency",
    "status",
    "ignore",
  ];

  const setRole = (column: number, role: ColumnRole | null) =>
    onDraft({
      ...draft,
      // A role used once moves here from any other column.
      roles: draft.roles.map((r, i) =>
        i === column
          ? role
          : role !== null && r === role && ONE_USE.includes(role)
            ? null
            : r,
      ),
    });
  const chooseAmounts = (value: boolean) => {
    setSplit(value);
    const gone: ColumnRole[] = value ? ["amount"] : ["debit", "credit"];
    onDraft({
      ...draft,
      roles: draft.roles.map((r) =>
        r !== null && gone.includes(r) ? null : r,
      ),
    });
  };

  const roleSelect = (column: number, labelled: object) => {
    const role = draft.roles[column] ?? null;
    const classes = ["select"];
    if (role === null) classes.push("is-placeholder");
    if (role === null && problems.length > 0) classes.push("is-warning");
    return (
      <span className="select-wrap">
        <select
          className={classes.join(" ")}
          value={role ?? ""}
          onChange={(e) =>
            setRole(column, (e.target.value || null) as ColumnRole | null)
          }
          {...labelled}
        >
          <option value="">Pick…</option>
          {roleChoices.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <Icon name="chevron" />
      </span>
    );
  };

  const read = readings.slice(0, SAMPLES);
  // A complete mapping that reads nothing has the wrong date format or mark.
  const noneReadable = problems.length === 0 && !readings.some(isReadable);
  // Left-out rows aren't imported, so what can't be read in them doesn't matter.
  const readProblems = read.flatMap((r) =>
    r.leftOut ? [] : r.problems.map((problem) => `Line ${r.line} · ${problem}`),
  );
  const leftOut = read.flatMap((r) =>
    r.leftOut
      ? [
          `line ${r.line} (${r.leftOut.reason === "currency" ? `in ${r.leftOut.value}` : r.leftOut.value})`,
        ]
      : [],
  );
  const unpicked = columns.filter((_, i) => draft.roles[i] === null);

  return (
    <>
      <div className="settings-row">
        <Field id={`${id}-dates`} label="Date format">
          <span className="select-wrap">
            <select
              id={`${id}-dates`}
              className="select"
              value={draft.dateFormat}
              onChange={(e) =>
                onDraft({ ...draft, dateFormat: e.target.value as DateFormat })
              }
            >
              {DATE_FORMATS.map((format) => (
                <option key={format}>{format}</option>
              ))}
            </select>
            <Icon name="chevron" />
          </span>
        </Field>
        <Field id={`${id}-mark`} label="Decimal separator">
          <span className="select-wrap">
            <select
              id={`${id}-mark`}
              className="select"
              value={draft.decimalMark}
              onChange={(e) =>
                onDraft({
                  ...draft,
                  decimalMark: e.target.value as DecimalMark,
                })
              }
            >
              {(["point", "comma"] as const).map((mark) => (
                <option key={mark} value={mark}>
                  {DECIMAL_LABELS[mark]}
                </option>
              ))}
            </select>
            <Icon name="chevron" />
          </span>
        </Field>
        <Field id={`${id}-amounts`} label="Amounts">
          <span className="select-wrap">
            <select
              id={`${id}-amounts`}
              className="select"
              value={split ? "split" : "one"}
              onChange={(e) => chooseAmounts(e.target.value === "split")}
            >
              <option value="one">One column (+ / −)</option>
              <option value="split">Debit and credit columns</option>
            </select>
            <Icon name="chevron" />
          </span>
        </Field>
      </div>

      {problems.length > 0 && (
        <div className="banner tone-warning" role="status">
          <Icon name="alert" />
          <span className="text">
            <strong>The mapping isn't complete</strong>
            {problems.join(" ")}
            {unpicked.length > 0 &&
              ` Still to pick: ${unpicked.map((c) => `“${c}”`).join(", ")}.`}
          </span>
        </div>
      )}

      {isMobile ? (
        <>
          <p className="label">Columns in the file</p>
          {columns.map((column, i) => (
            <section className="card" key={i}>
              <strong>{column}</strong>
              <Field id={`${id}-role-${i}`} label="Maps to">
                {roleSelect(i, { id: `${id}-role-${i}` })}
              </Field>
              <p className="caption">
                Samples:{" "}
                {rows
                  .map((row) => cellText(row.cells[i] ?? ""))
                  .filter((text) => text !== "")
                  .slice(0, 3)
                  .join(" · ") || "empty"}
              </p>
            </section>
          ))}
        </>
      ) : (
        <div className="field">
          <span className="label">Columns in the file</span>
          <section className="card grid-table">
            <table>
              <thead>
                <tr>
                  {columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="map-row">
                  {columns.map((column, i) => (
                    <td key={i}>
                      {roleSelect(i, {
                        "aria-label": `What “${column}” holds`,
                      })}
                    </td>
                  ))}
                </tr>
                {rows.map((row) => (
                  <tr key={row.line}>
                    {columns.map((_, i) => (
                      <td key={i} className="sample">
                        {cellText(row.cells[i] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <div className="field">
        <span className="label">Preview: how rows will be read</span>
        {noneReadable && (
          <div className="banner tone-warning" role="status">
            <Icon name="alert" />
            <span className="text">
              <strong>None of these rows can be read</strong>
              Check the date format and the decimal separator.
            </span>
          </div>
        )}
        <section className="card grid-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {read.map((row) => (
                <tr
                  key={row.line}
                  className={row.leftOut ? "is-left-out" : undefined}
                >
                  <td className={row.date ? undefined : "missing"}>
                    {row.date ? formatWhen(row.date, row.time) : "—"}
                  </td>
                  <td className={row.description ? "wrap" : "wrap missing"}>
                    {row.description || "—"}
                  </td>
                  <td
                    className={
                      row.amount === null || row.leftOut ? "num missing" : "num"
                    }
                  >
                    {row.leftOut
                      ? row.leftOut.reason === "currency"
                        ? `In ${row.leftOut.value}: left out`
                        : `${row.leftOut.value}: left out`
                      : row.amount === null
                        ? "—"
                        : formatAmount(row.amount, currency, {
                            signed: true,
                          })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {leftOut.length > 0 && (
          <p className="caption read-problems">
            Left out, as they're in another currency or not completed:{" "}
            {leftOut.join(", ")}.
          </p>
        )}
        {readProblems.length > 0 && (
          <ul className="read-problems">
            <li className="caption">
              {noneReadable
                ? "Why they can't be read:"
                : "Rows that can't be read are left out:"}
            </li>
            {readProblems.slice(0, 3).map((problem) => (
              <li className="caption" key={problem}>
                {problem}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
