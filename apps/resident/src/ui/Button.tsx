import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'default' | 'small';
  block?: boolean;
  loading?: boolean;
  /** Text announced and shown while loading, so the button never changes meaning silently. */
  loadingLabel?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'default',
  block,
  loading,
  loadingLabel,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'rp-btn',
    `rp-btn--${variant}`,
    size === 'small' ? 'rp-btn--small' : '',
    block ? 'rp-btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
    >
      {loading ? <span className="rp-spinner" aria-hidden="true" /> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
