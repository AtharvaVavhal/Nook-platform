import { formatINR } from '../utils/money';

interface MoneyProps {
  paise: number | bigint | string;
  showPaise?: boolean;
  showSymbol?: boolean;
  className?: string;
}

/**
 * Display monetary amounts from integer paise formatted as INR (₹) with Indian digit grouping.
 * Non-negotiable rule 3: Money is never edited, never calculated using floating-point math.
 */
export function Money({
  paise,
  showPaise = true,
  showSymbol = true,
  className = '',
}: MoneyProps) {
  const formatted = formatINR(paise, { showPaise, showSymbol });
  return <span className={`nook-money ${className}`.trim()}>{formatted}</span>;
}
