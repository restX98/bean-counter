import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useAccounts } from "../api.ts";
import { useIsMobile } from "../useIsMobile.ts";
import { Icon, Logo } from "./Icon.tsx";
import type { IconName } from "./icons.ts";

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
}

const NAV: (NavItem | "separator")[] = [
  { to: "/", icon: "home", label: "Dashboard" },
  { to: "/review", icon: "inbox", label: "Review" },
  { to: "/accounts", icon: "wallet", label: "Accounts" },
  { to: "/transactions", icon: "list", label: "Transactions" },
  { to: "/reports", icon: "chart", label: "Reports" },
  { to: "/budgets", icon: "gauge", label: "Budgets" },
  "separator",
  { to: "/categories", icon: "tag", label: "Categories" },
  { to: "/rules", icon: "rules", label: "Rules" },
  { to: "/settings", icon: "settings", label: "Settings" },
];

const TABS: NavItem[] = [
  { to: "/", icon: "home", label: "Home" },
  { to: "/transactions", icon: "list", label: "Transactions" },
  { to: "/reports", icon: "chart", label: "Reports" },
  { to: "/budgets", icon: "gauge", label: "Budgets" },
  { to: "/more", icon: "more", label: "More" },
];

/** Desktop: sidebar and page. Mobile: page and bottom tabs. */
export function Shell() {
  const isMobile = useIsMobile();
  return (
    <div className={isMobile ? "app is-mobile" : "app"}>
      {!isMobile && <Sidebar />}
      <main className="main">
        <Outlet />
      </main>
      {isMobile && <TabBar />}
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        Bean Counter
      </div>
      <ImportButton className="btn btn-primary btn-block" />
      <nav className="nav" aria-label="Main">
        {NAV.map((item, i) =>
          item === "separator" ? (
            <div className="nav-sep" key={i} />
          ) : (
            <NavLink key={item.to} to={item.to} end={item.to === "/"}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ),
        )}
      </nav>
    </aside>
  );
}

function TabBar() {
  const { pathname } = useLocation();
  // Everything without its own tab lives under More.
  const current =
    TABS.find((tab) =>
      tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to),
    ) ?? TABS[TABS.length - 1];
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={tab === current ? "page" : undefined}
        >
          <span className="tab-icon">
            <Icon name={tab.icon} />
          </span>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** Import needs an active account to import into; until then it's disabled. */
export function ImportButton({
  className = "btn btn-primary",
  label = "Import",
  account,
}: {
  className?: string;
  label?: string;
  /** Preselects this account in the import. */
  account?: number;
}) {
  const { data: accounts } = useAccounts();
  const ready = accounts?.some((a) => !a.archivedOn) ?? false;
  const content = (
    <>
      <Icon name="import" />
      {label}
    </>
  );
  return ready ? (
    <Link
      className={className}
      to={account ? `/import?account=${account}` : "/import"}
    >
      {content}
    </Link>
  ) : (
    // Without href an <a> has no role, so screen readers would ignore aria-disabled.
    <a
      className={className}
      role="link"
      aria-disabled="true"
      title="Add an account first"
    >
      {content}
    </a>
  );
}
