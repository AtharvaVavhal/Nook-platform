import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, LoadingState, useAsync } from '../finance/shared';
import { PageHead } from '../ops/ui';
import { opsApi, type InventorySummary } from '../ops/opsApi';
import { opsLinks } from '../ops/opsRoute';
import { Icon } from './BrandIllustration';

export function InventoryOverview() {
  const { data, loading, error, reload } = useAsync(
    () => opsApi.inventory.summary(),
    [],
  );
  return (
    <section id="inventory" className="inventory-section" aria-labelledby="inventory-heading">
      <PageHead
        title="Inventory at a glance"
        action={
          <a className="primary-button" href={opsLinks.properties}>
            Manage properties
          </a>
        }
      />
      {loading && !data ? <LoadingState label="Loading inventory…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data ? (
        <div
          className="inventory-table-wrap"
          role="region"
          aria-label="Inventory summary"
          tabIndex={0}
        >
          <table className="inventory-table">
            <caption className="sr-only">
              Inventory summary by organization.
            </caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Properties</th>
                <td>{data.properties}</td>
              </tr>
              <tr>
                <th scope="row">Floors</th>
                <td>{data.floors}</td>
              </tr>
              <tr>
                <th scope="row">Rooms</th>
                <td>{data.rooms}</td>
              </tr>
              <tr>
                <th scope="row">Total beds</th>
                <td>{data.beds}</td>
              </tr>
              <tr>
                <th scope="row">In service</th>
                <td className="available-text">
                  {data.bedsInService}
                  <span className="sr-only"> (operational status, not availability)</span>
                </td>
              </tr>
              <tr>
                <th scope="row">Out of service</th>
                <td className="unavailable-text">
                  {data.bedsOutOfService}
                  <span className="sr-only"> (operational status, not occupancy)</span>
                </td>
              </tr>
              <tr>
                <th scope="row">Archived</th>
                <td>{data.bedsArchived}</td>
              </tr>
            </tbody>
          </table>
          <p className="fin-form-error" style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-secondary)' }}>
            <Icon name="search" size={12} />
            "In service" = operational status (not booked/occupied).
            "Out of service" = held for maintenance.
            Occupancy is determined by active bookings and check-ins.
          </p>
        </div>
      ) : null}
    </section>
  );
}