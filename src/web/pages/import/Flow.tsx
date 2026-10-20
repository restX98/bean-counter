import { useEffect, type ReactNode } from "react";
import { Icon } from "../../components/Icon.tsx";
import { useIsMobile } from "../../useIsMobile.ts";

export const STEPS = [
  "Choose file",
  "Map columns",
  "Preview & resolve",
  "Done",
] as const;

interface FlowProps {
  /** The current step, from 1. */
  step: number;
  /** Steps passed over, such as the mapping when a preset matched. */
  skipped?: number[];
  onClose: () => void;
  /** Cancel or Back. */
  back: ReactNode;
  /** Continue or Import. */
  next: ReactNode;
  /** Why the next button is disabled (desktop). */
  hint?: string;
  children: ReactNode;
}

/**
 * The import's frame. Desktop: the page with a stepper and a footer. Mobile:
 * full screen, with a close button, a step bar and an action bar.
 */
export function Flow({
  step,
  skipped = [],
  onClose,
  back,
  next,
  hint,
  children,
}: FlowProps) {
  const isMobile = useIsMobile();
  const state = (n: number) =>
    n === step
      ? "is-current"
      : skipped.includes(n)
        ? "is-skipped"
        : n < step
          ? "is-done"
          : "is-todo";

  useEffect(() => {
    document.title = "Import statement · Bean Counter";
  }, []);

  if (isMobile) {
    return (
      <div className="m-flow">
        <header className="m-header">
          <button
            type="button"
            className="icon-btn back"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
          <h1>Import statement</h1>
        </header>
        <div className="m-steps">
          <div className="segs" aria-hidden="true">
            {STEPS.map((name, i) => (
              <span key={name} className={state(i + 1)} />
            ))}
          </div>
          <span>
            <strong>
              Step {step} of {STEPS.length}
            </strong>{" "}
            · {STEPS[step - 1]}
          </span>
        </div>
        <div className="m-scroll">
          <div className="m-page">{children}</div>
        </div>
        <div className="action-bar">
          {back}
          {next}
        </div>
      </div>
    );
  }

  return (
    <div className="flow">
      <div className="page">
        <div className="page-head">
          <h1>Import statement</h1>
          <ol className="stepper" aria-label="Import steps">
            {STEPS.map((name, i) => (
              <li
                key={name}
                className={`step ${state(i + 1)}`}
                aria-current={i + 1 === step ? "step" : undefined}
              >
                <span className="dot">
                  {state(i + 1) === "is-done" ? <Icon name="check" /> : i + 1}
                </span>
                {name}
              </li>
            ))}
          </ol>
        </div>
        {children}
      </div>
      <footer className="flow-foot">
        {back}
        {hint && <span className="hint">{hint}</span>}
        {next}
      </footer>
    </div>
  );
}
