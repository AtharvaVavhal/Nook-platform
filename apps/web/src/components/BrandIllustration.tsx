type IconName = 'building' | 'grid' | 'bed' | 'layers' | 'search' | 'arrow' | 'pin' | 'close';
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths = {
    building: (
      <>
        <path d="M4 21V5l8-2v18M12 8h8v13M2 21h20" />
        <path d="M8 7v1m0 3v1m0 3v1m8-4v1m0 3v1" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    bed: (
      <>
        <path d="M3 17V7m18 10V9H3m0 5h18M3 17v3m18-3v3M7 9V6h5v3" />
        <path d="M3 14v3h18v-3" />
      </>
    ),
    layers: <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function PropertyIllustration() {
  return (
    <svg className="property-illustration" viewBox="0 0 280 180" fill="none" aria-hidden="true">
      <circle cx="168" cy="87" r="77" fill="currentColor" opacity=".05" />
      <path
        d="M38 159h211M70 159V49l95-26v136M165 64l56 16v79M66 49l99-28 5 3"
        stroke="currentColor"
        strokeWidth="2"
      />
      {[0, 1, 2].map((row) => (
        <g key={row}>
          {[0, 1, 2].map((col) => (
            <path
              key={col}
              d={`M${84 + col * 25} ${62 + row * 29 - col * 6}v17l12-3V${59 + row * 29 - col * 6}Z`}
              fill="currentColor"
              opacity={row === 1 && col === 1 ? '.5' : '.17'}
            />
          ))}
        </g>
      ))}
      <path
        d="M105 159v-25l29-6v31M183 90v15l14 4V94Zm0 29v15l14 4v-15Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M43 158v-25m-10 0c-5-17 11-34 16-17 16-5 19 20 3 22"
        fill="currentColor"
        opacity=".22"
      />
    </svg>
  );
}
