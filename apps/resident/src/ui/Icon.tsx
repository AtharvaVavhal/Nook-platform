const CIRCLE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';
const PATHS = {
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  bed: [
    'M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8',
    'M3 15h18',
    'M7 9V7.5A1.5 1.5 0 0 1 8.5 6h2A1.5 1.5 0 0 1 12 7.5V9',
  ],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  card: [
    'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'M3 10h18',
    'M7 15h3',
  ],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  logout: ['M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  chevron: ['M9 6l6 6-6 6'],
  back: ['M15 18l-6-6 6-6'],
  alert: [CIRCLE, 'M12 8v5', 'M12 16.5v.01'],
  info: [CIRCLE, 'M12 11v5', 'M12 7.5v.01'],
  check: [CIRCLE, 'M8.5 12.5l2.5 2.5 4.5-5'],
  clock: [CIRCLE, 'M12 7v5l3 2'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  lock: ['M7 11V8a5 5 0 0 1 10 0v3', 'M6 11h12v9H6z'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  phone: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M11 18h2'],
  building: [
    'M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17',
    'M15 9h4a1 1 0 0 1 1 1v11',
    'M3 21h18',
    'M9 7h2',
    'M9 11h2',
    'M9 15h2',
  ],
  wifi: [
    'M2 9a15 15 0 0 1 20 0',
    'M5 12.5a10 10 0 0 1 14 0',
    'M8.5 16a5 5 0 0 1 7 0',
    'M12 19.5v.01',
    'M3 3l18 18',
  ],
  inbox: ['M3 13l3-8h12l3 8', 'M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6', 'M3 13h5l1 3h6l1-3h5'],
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative by default (aria-hidden): meaning is always carried by adjacent text. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...(className ? { className } : {})}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
