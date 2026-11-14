/**
 * Hash routing of the owner overview. The property is part of the hash, `#overview/<propertyId>`, and is parsed
 * separately from the section, so the section stays `overview` (navigation highlight, breadcrumb) whatever property is
 * selected. A legacy `#floor-plan` link (the demonstration floor plan no longer exists) lands on the dashboard.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OverviewRoute {
  /** First path segment of the hash; `overview` for the empty hash and for the legacy `#floor-plan`. */
  section: string;
  /** A well-formed property id from `#overview/<id>`, else null. */
  propertyId: string | null;
  /** `#overview/<something that is not a UUID>`: show a notice and the picker, make no request. */
  malformedPropertyId: boolean;
}

export function parseOverviewHash(hash: string): OverviewRoute {
  const parts = (hash.replace(/^#/, '').split('?')[0] ?? '').split('/').filter(Boolean);
  const first = parts[0] ?? 'overview';
  const section = first === 'floor-plan' ? 'overview' : first;
  if (section !== 'overview') return { section, propertyId: null, malformedPropertyId: false };
  const second = first === 'overview' ? parts[1] : undefined;
  if (second === undefined) return { section, propertyId: null, malformedPropertyId: false };
  return UUID.test(second)
    ? { section, propertyId: second.toLowerCase(), malformedPropertyId: false }
    : { section, propertyId: null, malformedPropertyId: true };
}

export const overviewHref = (propertyId: string) => `#overview/${propertyId}`;
