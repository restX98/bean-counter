import { ICONS, type IconName } from "./icons.ts";

export function Icon({
  name,
  className = "icon",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      aria-hidden="true"
      // The paths are constants from icons.ts, never user data.
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 28 28" aria-hidden="true">
      <ellipse
        cx="14"
        cy="14"
        rx="8.5"
        ry="12"
        transform="rotate(35 14 14)"
        className="logo-bean"
      />
      <path
        d="M9.6 20.6c2.6-2.2 2.4-5.4 4.4-7.6s4.6-2.7 4.4-6"
        className="logo-line"
      />
    </svg>
  );
}
