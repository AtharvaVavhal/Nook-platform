/**
 * The original Nook wordmark, served unmodified from /brand. It is a white mark, so it is only ever placed on Midnight Indigo
 * (the sidebar, the phone top bar, the sign-in brand panel and the loading screen). It is never recoloured, stretched or redrawn.
 */
const SRC = `${import.meta.env?.BASE_URL ?? '/'}brand/nook-logo-white.svg`;

export function Logo({ height, label = 'Nook' }: { height?: number; label?: string }) {
  return (
    <img
      src={SRC}
      alt={label}
      {...(height ? { height } : {})}
      style={{ height: height ?? undefined, width: 'auto' }}
      decoding="async"
    />
  );
}
