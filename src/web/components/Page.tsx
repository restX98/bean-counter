import { useEffect, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../api.ts";
import { useIsMobile } from "../useIsMobile.ts";
import { Icon } from "./Icon.tsx";

interface PageProps {
  title: string;
  /** The mobile header's title, when it differs (Dashboard is Home). */
  mobileTitle?: string;
  /** Next to the title, such as an Archived tag (desktop). */
  titleExtra?: ReactNode;
  /** Under the title (desktop). */
  subtitle?: ReactNode;
  /** The parent page, shown above the title (desktop). */
  crumb?: { to: string; label: string };
  /** Buttons on the right of the title (desktop). */
  actions?: ReactNode;
  /** The back button in the header (mobile). */
  back?: { to: string; label: string };
  /** Buttons on the right of the header (mobile). */
  mobileActions?: ReactNode;
  children: ReactNode;
}

/** A page's header and content: a page head on desktop, a top bar on mobile. */
export function Page({
  title,
  mobileTitle = title,
  titleExtra,
  subtitle,
  crumb,
  actions,
  back,
  mobileActions,
  children,
}: PageProps) {
  const isMobile = useIsMobile();

  useEffect(() => {
    document.title = `${title} · Bean Counter`;
  }, [title]);

  if (isMobile) {
    return (
      <>
        <header className="m-header">
          {back && (
            <Link
              className="icon-btn back"
              to={back.to}
              aria-label={back.label}
            >
              <Icon name="back" />
            </Link>
          )}
          <h1>{mobileTitle}</h1>
          {mobileActions}
        </header>
        <div className="m-page">{children}</div>
      </>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          {crumb && (
            <p className="crumb">
              <Link to={crumb.to}>{crumb.label}</Link>
              <span aria-hidden="true">/</span>
              <span>{title}</span>
            </p>
          )}
          <div className="title-line">
            <h1>{title}</h1>
            {titleExtra}
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** What a page shows while its data loads, or when loading failed. */
export function Loading({ error }: { error?: Error | null }) {
  if (error) {
    return (
      <div className="banner tone-danger" role="alert">
        <Icon name="alert" />
        <span className="text">
          <strong>Couldn't load this page</strong>
          {error instanceof ApiError ? error.message : "Try reloading it."}
        </span>
      </div>
    );
  }
  return <p className="muted">Loading…</p>;
}
