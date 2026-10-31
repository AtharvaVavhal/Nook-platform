interface DateTextProps {
  value: string | number | Date;
  className?: string;
  showTime?: boolean;
}

/**
 * Formats dates for Indian business usage: DD MMM YYYY (e.g., 31 Oct 2026).
 */
export function DateText({ value, className = '', showTime = false }: DateTextProps) {
  const dateObj = typeof value === 'object' && value instanceof Date ? value : new Date(value);

  if (isNaN(dateObj.getTime())) {
    return <span className={className}>Invalid date</span>;
  }

  const day = String(dateObj.getDate()).padStart(2, '0');
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = monthNames[dateObj.getMonth()];
  const year = dateObj.getFullYear();

  let formatted = `${day} ${month} ${year}`;
  if (showTime) {
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    formatted += `, ${hours}:${minutes}`;
  }

  return (
    <time dateTime={dateObj.toISOString()} className={`nook-date ${className}`.trim()}>
      {formatted}
    </time>
  );
}
