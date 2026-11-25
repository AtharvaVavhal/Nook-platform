import type { StatusView, Tone } from '../lib/status.js';
import { Icon, type IconName } from './Icon.js';

const ICON: Record<Tone, IconName> = {
  success: 'check',
  warning: 'clock',
  danger: 'alert',
  info: 'info',
  neutral: 'info',
  accent: 'clock',
};

/** A status is always text plus an icon, so it is never conveyed by colour alone. */
export function StatusBadge({ status }: { status: StatusView }) {
  return (
    <span className={`rp-badge rp-badge--${status.tone}`}>
      <Icon name={ICON[status.tone]} />
      {status.label}
    </span>
  );
}
