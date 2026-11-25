import { useEffect, useState } from 'react';

/** Whole seconds left until `endsAt` (a Date.now() timestamp), ticking once a second; 0 when there is nothing to wait for. */
export function useCountdown(endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
}
