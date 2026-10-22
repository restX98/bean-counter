import { Link } from "react-router";
import { useAccounts } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/icons.ts";
import { Page } from "../components/Page.tsx";
import { ImportButton, ReviewBadge } from "../components/Shell.tsx";
import { plural } from "../labels.ts";

/** The mobile More tab: everything without a tab of its own. */
export function More() {
  const { data: accounts = [] } = useAccounts();
  const archived = accounts.filter((a) => a.archivedOn).length;
  const active = accounts.length - archived;

  const rows: { to: string; icon: IconName; title: string; caption: string }[] =
    [
      {
        to: "/accounts",
        icon: "wallet",
        title: "Accounts",
        caption:
          accounts.length === 0
            ? "Add your bank accounts"
            : plural(active, "account") +
              (archived ? ` · ${archived} archived` : ""),
      },
      {
        to: "/review",
        icon: "inbox",
        title: "Review",
        caption: "Items waiting for your decision",
      },
      {
        to: "/categories",
        icon: "tag",
        title: "Categories",
        caption: "Income and expense categories",
      },
      {
        to: "/rules",
        icon: "rules",
        title: "Rules",
        caption: "Categorize transactions automatically",
      },
      {
        to: "/settings",
        icon: "settings",
        title: "Settings",
        caption: "Transfer window, presets, backup",
      },
    ];

  return (
    <Page title="More">
      <div className="card m-list">
        {rows.map((row) => (
          <Link key={row.to} className="more-row" to={row.to}>
            <Icon name={row.icon} />
            <span className="text">
              <strong>{row.title}</strong>
              <span className="caption">{row.caption}</span>
            </span>
            {row.to === "/review" && <ReviewBadge />}
            <Icon name="next" className="icon chev" />
          </Link>
        ))}
      </div>
      <ImportButton
        className="btn btn-primary btn-block"
        label="Import a statement"
      />
    </Page>
  );
}
