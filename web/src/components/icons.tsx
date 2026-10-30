import type { ReactNode } from 'react';

// 16×16 line icons drawn with `currentColor`, so they follow the button's text color in both themes.
const ICONS = {
  undo: <path d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6.5" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7h3" />,
  heading: <path d="M3.5 3v10M10.5 3v10M3.5 8h7M12.5 9.5l1.25-.75V13" />,
  size: <path d="M1.5 4h7M5 4v9.5M9 8h5.5M11.75 8v5.5" />,
  bold: <path strokeWidth={2} d="M4.5 2.75h4a2.6 2.6 0 0 1 0 5.2h-4zM4.5 7.95h4.75a2.65 2.65 0 0 1 0 5.3H4.5z" />,
  italic: <path d="M6.5 2.5h6M3.5 13.5h6M10 2.5 6 13.5" />,
  underline: <path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9" />,
  strike: (
    <path d="M11.3 4.6C10.8 3.3 9.6 2.5 8 2.5c-2 0-3.5 1-3.5 2.6 0 1 .6 1.7 1.7 2.1M2.5 8h11M10.4 9.6c.7.5 1.1 1.1 1.1 1.9 0 1.6-1.6 2.5-3.5 2.5-1.8 0-3.2-.8-3.6-2.2" />
  ),
  subscript: <path d="M2 3.5l6 7M8 3.5l-6 7M10.5 10.2a1.3 1.3 0 1 1 2.4.7l-2.4 2.6h2.9" />,
  superscript: <path d="M2 5.5l6 7M8 5.5l-6 7M10.5 3.2a1.3 1.3 0 1 1 2.4.7l-2.4 2.6h2.9" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  textColor: <path d="M4.5 10.5 8 2l3.5 8.5M5.75 7.5h4.5" />,
  highlight: <path d="M10 1.75 13.25 5 7.5 10.75H4.25V7.5zM8.25 3.5l3.25 3.25" />,
  clear: <path d="M3 3.5h8M7 3.5 5 13M9.5 9.5l4 4M13.5 9.5l-4 4" />,
  alignLeft: <path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7" />,
  alignCenter: <path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7" />,
  alignRight: <path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7" />,
  bulletList: (
    <>
      <path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
      <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  numberedList: (
    <path
      strokeWidth={1.25}
      d="M6.5 4h7M6.5 8h7M6.5 12h7M2.2 2.9l1-.6v3.2M2 8.3a1 1 0 1 1 1.7.7L2 10.6h1.9M2 12.1h1.8l-.9 1 .1 0a.9.9 0 1 1-.9 1.2"
    />
  ),
  descriptionList: <path d="M2.5 3.5h5M5.5 6.5h8M2.5 9.5h5M5.5 12.5h8" />,
  indent: <path d="M2.5 3h11M7.5 6.5h6M7.5 9.5h6M2.5 13h11M2.5 6l2 2-2 2" />,
  outdent: <path d="M2.5 3h11M7.5 6.5h6M7.5 9.5h6M2.5 13h11M4.5 6l-2 2 2 2" />,
  link: (
    <path d="M6.75 9.25a3 3 0 0 0 4.25 0l1.75-1.75a3 3 0 0 0-4.25-4.25l-.75.75M9.25 6.75a3 3 0 0 0-4.25 0L3.25 8.5a3 3 0 0 0 4.25 4.25l.75-.75" />
  ),
  footnote: <path d="M2.5 6h7M2.5 9h9M2.5 12h5.5M12 3l1.25-.75V6.5" />,
  comment: (
    <>
      <path d="M3.5 12.5l9-9" />
      <circle cx="4.5" cy="4.5" r="1.5" />
      <circle cx="11.5" cy="11.5" r="1.5" />
    </>
  ),
  inlineMath: <path d="M1.5 9l1.5 3.5L6.5 2.5h8M8.5 6.5l4 5.5M12.5 6.5l-4 5.5" />,
  displayMath: <path d="M4.5 2.5h-2v11h2M11.5 2.5h2v11h-2M6 6l4 4M10 6l-4 4" />,
  fraction: (
    <>
      <rect x="5.75" y="1.5" width="4.5" height="4" rx="1" />
      <path d="M2.5 8h11" />
      <rect x="5.75" y="10.5" width="4.5" height="4" rx="1" />
    </>
  ),
  omega: <path d="M2.5 13.5h3.25v-1.6a5 5 0 1 1 4.5 0v1.6h3.25" />,
  table: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.25h12M2 9.9h12M6 6.25v7.25M10 6.25v7.25" />
    </>
  ),
  label: (
    <>
      <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
      <circle cx="5.25" cy="5.25" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  ref: <path d="M7 3.5H3.5v9h9V9M9.5 2.5h4v4M13.5 2.5l-6 6" />,
  cite: (
    <path d="M3 7.5h3.25v4H3zM3 7.5c0-2.25.75-3.5 3-4.25M9.75 7.5H13v4H9.75zM9.75 7.5c0-2.25.75-3.5 3-4.25" />
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  caret: <path d="M5 6.5l3 3 3-3" />,
  chevronRight: <path d="M6.5 4l4 4-4 4" />,
  chevronLeft: <path d="M9.5 4l-4 4 4 4" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  minus: <path d="M3.5 8h9" />,
  plus: <path d="M3.5 8h9M8 3.5v9" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
