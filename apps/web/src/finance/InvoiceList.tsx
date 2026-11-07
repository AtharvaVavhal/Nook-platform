import { useState } from 'react';
import { financeApi } from './financeApi';
import { formatDate, formatMoney, monthLabel, statusLabels } from './financeFormat';
import { financeLinks } from './financeRoute';
import { EmptyState, ErrorState, LoadingState, Pager, StatusBadge, useAsync } from './shared';

const STATUS_FILTERS = [
  '',
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'OVERDUE',
  'PAID',
  'CANCELLED',
] as const;

export function InvoiceList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useAsync(
    () => financeApi.listInvoices({ page, limit: 20, status, search }),
    [page, status, search],
  );

  return (
    <section aria-labelledby="fin-invoices-title">
      <div className="fin-card-head">
        <h2 id="fin-invoices-title">Invoices</h2>
        <a className="primary-button" href={financeLinks.newInvoice}>
          New invoice
        </a>
      </div>
      <form
        className="fin-toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(searchInput.trim());
        }}
      >
        <label className="fin-field">
          <span>Search</span>
          <input
            type="search"
            placeholder="Resident or invoice number"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>
        <label className="fin-field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
            }}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s ? statusLabels[s] : 'All statuses'}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="outline-button">
          Search
        </button>
      </form>

      {loading && !data ? <LoadingState label="Loading invoices…" /> : null}
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {data && data.items.length === 0 && !error ? (
        <EmptyState
          title={search || status ? 'No invoices match these filters' : 'No invoices yet'}
          hint={
            search || status
              ? 'Try clearing the search or status filter.'
              : 'Create an invoice, or generate this month’s invoices from the new-invoice page.'
          }
        />
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="fin-table-wrap" aria-busy={loading}>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Resident</th>
                <th>Billing period</th>
                <th className="num">Amount</th>
                <th className="num">Balance</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <a href={financeLinks.invoice(invoice.id)}>{invoice.number}</a>
                  </td>
                  <td>{invoice.residentName}</td>
                  <td>{monthLabel(invoice.periodStart.slice(0, 7))}</td>
                  <td className="num">{formatMoney(invoice.amount)}</td>
                  <td className="num">{formatMoney(invoice.balance)}</td>
                  <td>{formatDate(invoice.dueDate)}</td>
                  <td>
                    <StatusBadge status={invoice.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {data ? <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} /> : null}
    </section>
  );
}
