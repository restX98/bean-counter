import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

interface FieldProps {
  /** The id of the control the label is for. */
  id: string;
  label: string;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  /** A group of controls (radios, two inputs): the label names the group. */
  group?: boolean;
  children: ReactNode;
}

/**
 * A label, its control, an error and a hint. Controls point to the error and
 * the hint with describedBy(id, error, hint).
 */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  group,
  children,
}: FieldProps) {
  const text = (
    <>
      {label}
      {optional && <span className="optional"> (optional)</span>}
    </>
  );
  return (
    <div className="field">
      {group ? (
        <span className="label" id={`${id}-label`}>
          {text}
        </span>
      ) : (
        <label className="label" htmlFor={id}>
          {text}
        </label>
      )}
      {children}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alert" className="icon icon-sm" />
          {error}
        </p>
      )}
      {hint && (
        <p className="caption" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** aria props tying a control to its field's error and hint. */
export function describedBy(id: string, error?: string, hint?: unknown) {
  const ids = [error && `${id}-error`, hint ? `${id}-hint` : ""].filter(
    Boolean,
  );
  return {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
  };
}
