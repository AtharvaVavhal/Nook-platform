import { useEffect, useState } from 'react';
import './finance.css';
import { CorrectionHistory } from './CorrectionHistory';
import { CreateInvoice } from './CreateInvoice';
import { FinanceDashboard } from './FinanceDashboard';
import { InvoiceDetail } from './InvoiceDetail';
import { InvoiceList } from './InvoiceList';
import { MonthlyReports } from './MonthlyReports';
import { OutstandingPayments } from './OutstandingPayments';
import { ReceiptView } from './ReceiptView';
import { financeLinks, parseFinanceRoute, type FinanceRoute } from './financeRoute';

const TABS: Array<{ href: string; label: string; match: FinanceRoute['name'][] }> = [
  { href: financeLinks.dashboard, label: 'Overview', match: ['dashboard'] },
  {
    href: financeLinks.invoices,
    label: 'Invoices',
    match: ['invoices', 'invoice', 'new-invoice', 'receipt'],
  },
  { href: financeLinks.outstanding, label: 'Outstanding', match: ['outstanding'] },
  { href: financeLinks.reports, label: 'Reports', match: ['reports'] },
  { href: financeLinks.corrections, label: 'Corrections', match: ['corrections'] },
];

export function FinanceShell() {
  const [route, setRoute] = useState<FinanceRoute>(() => parseFinanceRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseFinanceRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="fin">
      <div className="page-heading fin-noprint">
        <div>
          <p className="eyebrow violet">FINANCE &amp; BILLING</p>
          <h1>Finance</h1>
          <p className="page-description">Monthly rent, payments and receipts, in one place.</p>
        </div>
        <a className="primary-button" href={financeLinks.newInvoice}>
          New invoice
        </a>
      </div>
      <nav className="fin-tabs fin-noprint" aria-label="Finance sections">
        {TABS.map((tab) => (
          <a
            key={tab.href}
            href={tab.href}
            aria-current={tab.match.includes(route.name) ? 'page' : undefined}
          >
            {tab.label}
          </a>
        ))}
      </nav>
      <div key={window.location.hash}>
        {route.name === 'dashboard' ? <FinanceDashboard /> : null}
        {route.name === 'invoices' ? <InvoiceList /> : null}
        {route.name === 'new-invoice' ? <CreateInvoice /> : null}
        {route.name === 'invoice' ? <InvoiceDetail id={route.id} /> : null}
        {route.name === 'outstanding' ? <OutstandingPayments /> : null}
        {route.name === 'reports' ? <MonthlyReports /> : null}
        {route.name === 'corrections' ? <CorrectionHistory /> : null}
        {route.name === 'receipt' ? (
          <ReceiptView invoiceId={route.invoiceId} paymentId={route.paymentId} />
        ) : null}
      </div>
    </div>
  );
}
