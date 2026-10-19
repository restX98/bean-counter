import { EmptyState } from "../components/EmptyState.tsx";
import { Page } from "../components/Page.tsx";

/** Stands in for a screen that a later step builds. */
export function NotBuilt({
  title,
  inMore = false,
}: {
  title: string;
  /** Mobile: the screen is reached from More, so its header goes back there. */
  inMore?: boolean;
}) {
  return (
    <Page
      title={title}
      back={inMore ? { to: "/more", label: "Back to More" } : undefined}
    >
      <EmptyState icon="info" title="Not built yet">
        This screen comes in a later step.
      </EmptyState>
    </Page>
  );
}

export function NotFound() {
  return (
    <Page title="Page not found">
      <EmptyState icon="info" title="There's nothing here">
        Check the address, or pick a page from the menu.
      </EmptyState>
    </Page>
  );
}
