/** Marks a section that shows illustrative data rather than the organization's real records. */
export function DemoBadge() {
  return (
    <span
      className="environment-badge demo-badge"
      title="Illustrative sample data. It is not connected to your records."
    >
      DEMO DATA
    </span>
  );
}
