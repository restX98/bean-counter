// SVG paths for the 20 × 20 icons, the same as in docs/design/screens.

export const ICONS = {
  home: '<path d="M3.5 9.5 10 4l6.5 5.5V16a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/><path d="M8 17v-5h4v5"/>',
  inbox:
    '<path d="M3 11.5 5 4.5h10l2 7V16H3z"/><path d="M3 11.5h4l1 2h4l1-2h4"/>',
  wallet:
    '<rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3 8.5h14M13 12.5h1.5"/>',
  list: '<path d="M7.5 5.5H17M7.5 10H17M7.5 14.5H17M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01"/>',
  chart: '<path d="M3 17h14M5.5 14V9M10 14V4.5M14.5 14v-6"/>',
  gauge: '<path d="M3.5 14a6.5 6.5 0 1 1 13 0"/><path d="m10 14 3-4"/>',
  tag: '<path d="M3.5 10.2V4.5a1 1 0 0 1 1-1h5.7l6.3 6.3a1 1 0 0 1 0 1.4l-5.3 5.3a1 1 0 0 1-1.4 0z"/><path d="M7 7h.01"/>',
  rules: '<path d="M4 5h12M6.5 10h7M9 15h2"/>',
  settings:
    '<path d="M3.5 6H10M14 6h2.5M3.5 14H6M10 14h6.5"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>',
  import: '<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 13.5V16h12v-2.5"/>',
  more: '<path d="M4.5 10h.01M10 10h.01M15.5 10h.01" stroke-width="2.6"/>',
  chevron: '<path d="m6 8 4 4 4-4"/>',
  arrow: '<path d="M4 10h12M11 5l5 5-5 5"/>',
  back: '<path d="M16 10H4M9 5l-5 5 5 5"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  alert: '<path d="M10 3.5 17.5 16.5h-15z"/><path d="M10 8.5V12M10 14.2h.01"/>',
  x: '<path d="m5 5 10 10M15 5 5 15"/>',
  transfer: '<path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v4.5M10 6.5h.01"/>',
  scale:
    '<path d="M10 3.5v13M5 16.5h10M4 6.5h12M6 6.5 3.5 12a2.5 2.5 0 0 0 5 0zM14 6.5 11.5 12a2.5 2.5 0 0 0 5 0z"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.3 3.3"/>',
  filter: '<path d="M3.5 5h13l-5 6v4.5l-3 1.5V11z"/>',
  payback:
    '<path d="M8 5.5 4.5 9 8 12.5"/><path d="M4.5 9H12a4 4 0 0 1 0 8h-1.5"/>',
  "eye-off":
    '<path d="m3.5 3.5 13 13"/><path d="M8.3 5.2A7 7 0 0 1 10 5c4.5 0 7 5 7 5a12 12 0 0 1-2.1 2.7M11.7 14.8A7 7 0 0 1 10 15c-4.5 0-7-5-7-5a12 12 0 0 1 2.1-2.7"/>',
  file: '<path d="M5.5 2.5h6l4 4v11h-10z"/><path d="M11.5 2.5v4h4"/>',
  prev: '<path d="m12 5-5 5 5 5"/>',
  next: '<path d="m8 5 5 5-5 5"/>',
  unlink:
    '<path d="M7.5 12.5 5.8 14.2a2.5 2.5 0 0 1-3.5-3.5L4 9M12.5 7.5l1.7-1.7a2.5 2.5 0 0 1 3.5 3.5L16 11M3 3l2 2M15 15l2 2"/>',
} as const;

export type IconName = keyof typeof ICONS;
