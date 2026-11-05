/**
 * Decorative line-art elevation of a hostel building. Drawn in `currentColor` so the parent controls
 * the line tone; the few lit windows use the Nook Violet brand token.
 */
const LIT_WINDOWS = new Set(['0-1', '1-3', '2-0', '1-1']);
/** Ground-floor bays that the entrance arch stands in front of. */
const ENTRANCE_BAYS = new Set(['2-1', '2-2']);

export function HostelIllustration({ className }: { className?: string }) {
  const floors = [0, 1, 2];
  const bays = [0, 1, 2, 3];
  return (
    <svg
      className={className}
      viewBox="0 0 480 320"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* ground line */}
      <path d="M12 288h456" strokeOpacity="0.35" />
      <path d="M48 296h384" strokeOpacity="0.15" />

      {/* main block */}
      <rect x="64" y="64" width="352" height="224" rx="3" strokeOpacity="0.5" />
      <path d="M52 64h376" strokeOpacity="0.7" strokeWidth="2" />
      <path d="M64 64v-10h352v10" strokeOpacity="0.25" />

      {/* floor lines */}
      <path d="M64 130h352M64 196h352" strokeOpacity="0.18" />

      {/* windows */}
      {floors.map((floor) =>
        bays.map((bay) => {
          const x = 92 + bay * 82;
          const y = 82 + floor * 66;
          if (ENTRANCE_BAYS.has(`${floor}-${bay}`)) return null;
          const lit = LIT_WINDOWS.has(`${floor}-${bay}`);
          return (
            <g key={`${floor}-${bay}`}>
              <rect
                x={x}
                y={y}
                width="50"
                height="36"
                rx="2"
                strokeOpacity="0.45"
                fill={lit ? 'var(--color-brand-accent)' : 'none'}
                fillOpacity={lit ? 0.35 : 0}
                stroke={lit ? 'var(--color-brand-accent)' : 'currentColor'}
                strokeWidth={lit ? 1.75 : 1.5}
              />
              <path d={`M${x + 25} ${y}v36`} strokeOpacity="0.2" />
            </g>
          );
        }),
      )}

      {/* entrance */}
      <path d="M206 288v-44a34 34 0 0 1 68 0v44" strokeOpacity="0.6" />
      <path d="M240 244v44" strokeOpacity="0.3" />
      <path d="M194 288h92" strokeOpacity="0.5" />
      <path d="M216 226h48" strokeOpacity="0.25" />

      {/* side wings */}
      <path d="M12 288V176h52" strokeOpacity="0.3" />
      <path d="M416 176h52v112" strokeOpacity="0.3" />
      <rect x="26" y="196" width="24" height="26" rx="2" strokeOpacity="0.25" />
      <rect x="430" y="196" width="24" height="26" rx="2" strokeOpacity="0.25" />
    </svg>
  );
}
