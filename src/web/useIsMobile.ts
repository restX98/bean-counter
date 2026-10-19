import { useSyncExternalStore } from "react";

// The same breakpoint as tokens.css: below 768px the app uses the mobile layout.
const query = window.matchMedia("(max-width: 767px)");

const subscribe = (onChange: () => void) => {
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => query.matches);
}
