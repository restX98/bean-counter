import { EmptyState } from "../components/EmptyState.tsx";
import { Page } from "../components/Page.tsx";

export function NotFound() {
  return (
    <Page title="Page not found">
      <EmptyState icon="info" title="There's nothing here">
        Check the address, or pick a page from the menu.
      </EmptyState>
    </Page>
  );
}
