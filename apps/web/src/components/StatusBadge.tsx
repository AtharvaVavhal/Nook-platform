export type BadgeVariant =
  | 'available'
  | 'occupied'
  | 'unavailable'
  | 'pending'
  | 'success'
  | 'danger'
  | 'warning'
  | 'neutral'
  | 'demo';

interface StatusBadgeProps {
  variant: BadgeVariant;
  label?: string;
  className?: string;
}

const DEFAULT_LABELS: Record<BadgeVariant, string> = {
  available: 'Available',
  occupied: 'Occupied',
  unavailable: 'Unavailable',
  pending: 'Pending',
  success: 'Confirmed',
  danger: 'Overdue',
  warning: 'Notice',
  neutral: 'Archived',
  demo: 'Demo Data',
};

export function StatusBadge({ variant, label, className = '' }: StatusBadgeProps) {
  const displayLabel = label ?? DEFAULT_LABELS[variant] ?? variant;

  return (
    <span className={`status-pill ${variant} ${className}`.trim()}>
      <span className={`legend-dot ${variant}`} aria-hidden="true" />
      <span>{displayLabel}</span>
    </span>
  );
}
