import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./icons.ts";

/** A card that explains the next step, with one main action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  after,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** Below the action, such as the first-run steps. */
  after?: ReactNode;
}) {
  return (
    <section className="card">
      <div className="empty">
        <span className="empty-icon">
          <Icon name={icon} />
        </span>
        <h2>{title}</h2>
        <p>{children}</p>
        {action}
        {after}
      </div>
    </section>
  );
}

const FIRST_RUN = [
  "Add an account",
  "Import a CSV or Excel statement",
  "Review what the app couldn't sort",
];

/** The first-run steps; `next` is the index of the step to do now. */
export function FirstRunSteps({ next }: { next: number }) {
  return (
    <ol className="steps">
      {FIRST_RUN.map((step, i) => (
        <li
          key={step}
          className={i < next ? "is-done" : i === next ? "is-next" : undefined}
        >
          {step}
          {i < next && <span className="visually-hidden"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}
