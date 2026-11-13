import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, LoadingState, Pager, useAsync } from '../finance/shared';
import { Field, FormError, PageHead, Tag, useGuardedAction } from './ui';
import {
  opsApi,
  OpsApiError,
  type CorrectionDetail as DetailData,
  type CorrectionFieldKey,
  type CorrectionSummary,
  type CorrectionTargetType,
  type FinanceReviewItem,
} from './opsApi';
import {
  CommandKeys,
  FIELD_OPTIONS,
  STALE_CAUSE_LABEL,
  STATUS_LABEL,
  TARGET_LABELS,
  adviceFor,
  browserKeyStorage,
  commandSignature,
  evidenceLikelyRequired,
  fieldLabel,
  fieldsFor,
  keepsKey,
  nowIstLocal,
  optionFor,
  proposedPayload,
  toZonedInstant,
  validateProposed,
  valueText,
  type Advice,
} from './correctionRules';
import { correctionsLinks } from './opsRoute';
import './ops.css';

/**
 * Correction screens (specification v1.3 section 15). Rules this file keeps:
 *  - A proposed value is always labelled "Proposed" and never shown as the current fact.
 *  - What the operator may do comes from the server's `allowedActions`; the buttons never decide authority.
 *  - An Idempotency-Key is kept across network failures and "retry required" answers, and dropped on a definitive answer.
 */

const keys = new CommandKeys(browserKeyStorage());

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ')} IST`;
}

function StatusTag({ status }: { status: string }) {
  return <Tag>{STATUS_LABEL[status] ?? status}</Tag>;
}

/** Sends one command with its persisted key and turns the answer into advice for the operator. */
function useCommand() {
  const action = useGuardedAction();
  const [advice, setAdvice] = useState<Advice | null>(null);
  async function send(
    signature: string,
    call: (key: string) => Promise<unknown>,
  ): Promise<{ ok: boolean; advice: Advice | null }> {
    setAdvice(null);
    const key = keys.keyFor(signature);
    let outcome: Advice | null = null;
    const ok = await action.run(async () => {
      try {
        await call(key);
        keys.clear(signature);
      } catch (e) {
        const status = e instanceof OpsApiError ? e.status : 0;
        const code = e instanceof OpsApiError ? e.code : undefined;
        outcome = adviceFor(status, code, e instanceof Error ? e.message : 'Something went wrong.');
        if (!keepsKey(outcome)) keys.clear(signature);
        throw e;
      }
    });
    setAdvice(ok ? null : outcome);
    return { ok, advice: ok ? null : outcome };
  }
  return { ...action, advice, send };
}

// ---------------------------------------------------------------------------------------------------- queue

export function CorrectionList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [targetType, setTargetType] = useState('');
  const [financial, setFinancial] = useState('');
  const query = useAsync(
    useCallback(
      () =>
        opsApi.corrections.list({
          page,
          limit: 20,
          status,
          targetType,
          financialImpact: financial,
        }),
      [page, status, targetType, financial],
    ),
    [page, status, targetType, financial],
  );
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1;
  return (
    <section aria-labelledby="corrections-head">
      <PageHead
        title="Corrections"
        action={
          <a className="fin-btn fin-btn-primary" href={correctionsLinks.new()}>
            Request a correction
          </a>
        }
      />
      <p className="fin-lede" id="corrections-head">
        A correction fixes a recording mistake. It changes nothing until a different person approves
        it.
      </p>
      <div className="ops-inline-form" role="group" aria-label="Filters">
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {Object.keys(STATUS_LABEL).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Record type">
          <select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {Object.entries(TARGET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Needs owner">
          <select
            value={financial}
            onChange={(e) => {
              setFinancial(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Any</option>
            <option value="true">Financial only</option>
            <option value="false">Non-financial only</option>
          </select>
        </Field>
      </div>
      {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      {query.loading && !query.data ? <LoadingState label="Loading corrections…" /> : null}
      {query.data && query.data.items.length === 0 ? (
        <EmptyState title="No corrections" hint="Nothing matches these filters." />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Record</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Requested</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((c: CorrectionSummary) => (
                <tr key={c.id}>
                  <td>
                    <a href={correctionsLinks.detail(c.id)}>{fieldLabel(c.fieldKey)}</a>
                  </td>
                  <td>{TARGET_LABELS[c.targetType]}</td>
                  <td>
                    <StatusTag status={c.status} />
                  </td>
                  <td>{c.requester.displayName}</td>
                  <td>{formatWhen(c.recordedAt)}</td>
                  <td>
                    {c.status !== 'PENDING'
                      ? '—'
                      : c.exceptionRequired
                        ? 'Owner · older record'
                        : c.financialImpact
                          ? 'Owner'
                          : 'Owner or manager'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {totalPages > 1 ? <Pager page={page} totalPages={totalPages} onPage={setPage} /> : null}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------- request form

function readHashParams(): URLSearchParams {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at >= 0 ? hash.slice(at + 1) : '');
}

export function CorrectionNew() {
  const params = useMemo(readHashParams, []);
  const initialTarget = (params.get('targetType') as CorrectionTargetType | null) ?? 'RESIDENT';
  const [targetType, setTargetType] = useState<CorrectionTargetType>(
    FIELD_OPTIONS.some((f) => f.target === initialTarget) ? initialTarget : 'RESIDENT',
  );
  const [targetId, setTargetId] = useState(params.get('targetId') ?? '');
  const [field, setField] = useState<CorrectionFieldKey>(
    (params.get('field') as CorrectionFieldKey | null) ?? fieldsFor(targetType)[0]!.field,
  );
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(nowIstLocal());
  const [evidence, setEvidence] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cmd = useCommand();
  const option = optionFor(field) ?? fieldsFor(targetType)[0]!;
  const prefilled = Boolean(params.get('targetId'));

  function changeTarget(next: CorrectionTargetType) {
    setTargetType(next);
    setField(fieldsFor(next)[0]!.field);
    setValue('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId.trim()))
      found.targetId =
        'Enter the record id (open the record and use its Request a correction link).';
    const bad = validateProposed(option, value);
    if (bad) found.value = bad;
    if (reason.trim().length < 1) found.reason = 'Explain why this correction is needed.';
    if (reason.length > 2000) found.reason = 'Use at most 2000 characters.';
    if (evidence.length > 2000) found.evidence = 'Use at most 2000 characters.';
    if (!effectiveAt) found.effectiveAt = 'Enter when the corrected fact applies.';
    setErrors(found);
    if (Object.keys(found).length) return;
    const payload = {
      targetType,
      targetId: targetId.trim().toLowerCase(),
      fieldKey: field,
      proposedValue: proposedPayload(option, value),
      reason: reason.trim(),
      effectiveAt: toZonedInstant(effectiveAt),
      ...(evidence.trim() ? { evidenceReference: evidence.trim() } : {}),
    };
    const signature = commandSignature(['submit', JSON.stringify(payload)]);
    let created: DetailData | null = null;
    const { ok } = await cmd.send(signature, async (key) => {
      created = await opsApi.corrections.submit(key, payload);
    });
    if (ok && created) window.location.hash = correctionsLinks.detail((created as DetailData).id);
  }

  return (
    <section aria-labelledby="correction-new-head">
      <p>
        <a href={correctionsLinks.list}>← All corrections</a>
      </p>
      <PageHead title="Request a correction" />
      <p className="fin-lede" id="correction-new-head">
        Nothing changes now. A different person reviews this, and the record changes only when they
        approve it.
      </p>
      <form className="ops-form" onSubmit={submit} noValidate>
        <div className="ops-grid">
          <Field label="Record type">
            <select
              value={targetType}
              disabled={prefilled}
              onChange={(e) => changeTarget(e.target.value as CorrectionTargetType)}
            >
              {Object.entries(TARGET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Record id" error={errors.targetId}>
            <input
              value={targetId}
              readOnly={prefilled}
              onChange={(e) => setTargetId(e.target.value)}
            />
          </Field>
          <Field label="What to correct">
            <select
              value={field}
              onChange={(e) => {
                setField(e.target.value as CorrectionFieldKey);
                setValue('');
              }}
            >
              {fieldsFor(targetType).map((f) => (
                <option key={f.field} value={f.field}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={`Corrected value${option.input === 'nullableText' ? ' (optional)' : ''}`}
            error={errors.value}
          >
            {option.input === 'date' ? (
              <input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
            ) : option.input === 'instant' ? (
              <input
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            ) : option.input === 'money' ? (
              <input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="8500.00"
              />
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} />
            )}
          </Field>
        </div>
        <p className="fin-hint">{option.hint} Date and time are Asia/Kolkata.</p>
        {option.financial ? (
          <p className="fin-hint" role="note">
            This is a financial correction. Only an owner can review it. It does not change any
            issued invoice.
          </p>
        ) : null}
        <Field label="Why is this needed?" error={errors.reason}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="When does the corrected fact apply?" error={errors.effectiveAt}>
          <input
            type="datetime-local"
            value={effectiveAt}
            max={nowIstLocal()}
            onChange={(e) => setEffectiveAt(e.target.value)}
          />
        </Field>
        <Field
          label={`Evidence${evidenceLikelyRequired(field) ? ' (usually required for this field)' : ' (optional)'}`}
          error={errors.evidence}
        >
          <textarea
            rows={2}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            placeholder="Where a reviewer can find proof, e.g. 'Admission register 2026, line 14'. Do not paste links with passwords."
          />
        </Field>
        <FormError message={cmd.advice ? cmd.advice.message : cmd.error} />
        <div className="ops-actions">
          <button className="fin-btn fin-btn-primary" type="submit" disabled={cmd.busy}>
            {cmd.busy
              ? 'Sending…'
              : cmd.advice?.kind === 'retry-same-key'
                ? 'Retry'
                : 'Submit correction'}
          </button>
          <a className="fin-btn" href={correctionsLinks.list}>
            Cancel
          </a>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------- review screen

export function CorrectionDetail({ id }: { id: string }) {
  const query = useAsync(
    useCallback(() => opsApi.corrections.get(id), [id]),
    [id],
  );
  const c = query.data;
  return (
    <section aria-labelledby="correction-head">
      <p>
        <a href={correctionsLinks.list}>← All corrections</a>
      </p>
      {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      {query.loading && !c ? <LoadingState label="Loading correction…" /> : null}
      {c ? <DetailBody c={c} onChanged={query.reload} /> : null}
    </section>
  );
}

function DetailBody({ c, onChanged }: { c: DetailData; onChanged: () => void }) {
  const pending = c.status === 'PENDING';
  return (
    <>
      <PageHead
        id="correction-head"
        title={`${TARGET_LABELS[c.targetType]}: ${fieldLabel(c.fieldKey)}`}
        action={<StatusTag status={c.status} />}
      />
      {pending ? (
        <p className="fin-hint" role="note">
          This is a proposed change. The record still shows the current value until it is approved.
        </p>
      ) : null}
      {c.status === 'STALE' ? (
        <p className="fin-form-error" role="alert">
          This correction can no longer be applied:{' '}
          {STALE_CAUSE_LABEL[c.staleCause ?? ''] ?? 'the record changed'} after it was proposed.
          Submit a new correction.{' '}
          <a
            href={correctionsLinks.new({
              targetType: c.targetType,
              targetId: c.targetId,
              field: c.fieldKey,
            })}
          >
            Start a new one
          </a>
        </p>
      ) : null}
      <div className="fin-table-wrap">
        <table className="fin-table" aria-label="Before and after">
          <thead>
            <tr>
              <th />
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Current value when proposed</th>
              <td>{valueText(c.originalValue, c.fieldKey)}</td>
            </tr>
            <tr>
              <th scope="row">{c.status === 'APPLIED' ? 'Applied value' : 'Proposed value'}</th>
              <td>
                {valueText(
                  c.status === 'APPLIED' ? (c.appliedValue ?? c.proposedValue) : c.proposedValue,
                  c.fieldKey,
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="ops-kv">
        <dt>Why</dt>
        <dd>{c.reason}</dd>
        <dt>Evidence</dt>
        <dd>{c.evidenceReference ?? 'None given'}</dd>
        <dt>Applies from</dt>
        <dd>{formatWhen(c.effectiveAt)}</dd>
        <dt>Requested</dt>
        <dd>
          {formatWhen(c.recordedAt)} by {c.requester.displayName}
        </dd>
        <dt>Age of the fact</dt>
        <dd>
          {c.ageDays} day{c.ageDays === 1 ? '' : 's'}
          {c.exceptionRequired
            ? ` — older than ${c.normalWindowDays} days: owner review with an exception reason`
            : ''}
        </dd>
        <dt>Needs</dt>
        <dd>
          {c.financialImpact || c.exceptionRequired ? 'An owner' : 'An owner or a manager'} other
          than the requester
        </dd>
        {c.reviewer ? (
          <>
            <dt>Decided</dt>
            <dd>
              {formatWhen(c.decidedAt)} by {c.reviewer.displayName}
            </dd>
          </>
        ) : null}
        {c.decisionReason ? (
          <>
            <dt>Decision note</dt>
            <dd>{c.decisionReason}</dd>
          </>
        ) : null}
        {c.exceptionRationale ? (
          <>
            <dt>Exception reason</dt>
            <dd>{c.exceptionRationale}</dd>
          </>
        ) : null}
      </dl>
      <FinanceBlock c={c} />
      <Decisions c={c} onChanged={onChanged} />
    </>
  );
}

function FinanceBlock({ c }: { c: DetailData }) {
  if (c.financeReviewStatus === 'NONE') {
    return c.status === 'APPLIED' && c.financialImpact ? (
      <p className="fin-hint">No billing follow-up was needed. Issued invoices were not changed.</p>
    ) : null;
  }
  return (
    <section className="profile-card" aria-label="Billing review">
      <h3 className="profile-section-title">
        Billing review {c.financeReviewStatus === 'REVIEW_REQUIRED' ? '— still open' : '— resolved'}
      </h3>
      <p className="fin-hint">
        The record is corrected, but this does not change what anyone owes. Issued invoices are
        unchanged, and no credit or refund has been made. An owner decides separately.
      </p>
      <ul className="ops-list-plain">
        {c.financeReviewLinks.map((l) => (
          <li key={l.id}>
            {l.kind === 'BILLING_GAP'
              ? `Invoice not yet created for ${l.period ?? 'a month'}`
              : 'Issued invoice to review'}{' '}
            — {l.resolved ? 'resolved' : 'open'}
            {l.invoiceId ? (
              <>
                {' '}
                · <a href={`#finance/invoices/${l.invoiceId}`}>open invoice</a>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decisions({ c, onChanged }: { c: DetailData; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [exception, setException] = useState('');
  const cmd = useCommand();
  if (c.allowedActions.length === 0) return null;
  const canDecide = c.allowedActions.includes('approve');
  async function run(kind: 'approve' | 'reject' | 'withdraw') {
    if (note.trim() === '') return cmd.setError('Write a short note for the record first.');
    if (kind === 'approve' && c.exceptionRequired && exception.trim() === '') {
      return cmd.setError(
        'This fact is older than the normal window. Explain why the correction is justified.',
      );
    }
    const signature = commandSignature([kind, c.id, note.trim(), exception.trim()]);
    const { ok, advice } = await cmd.send(signature, (key) =>
      kind === 'approve'
        ? opsApi.corrections.approve(key, c.id, {
            decisionReason: note.trim(),
            ...(exception.trim() ? { exceptionRationale: exception.trim() } : {}),
          })
        : kind === 'reject'
          ? opsApi.corrections.reject(key, c.id, { reason: note.trim() })
          : opsApi.corrections.withdraw(key, c.id, { reason: note.trim() }),
    );
    // A stale or conflicting answer changes what the server knows: refresh so the screen shows the truth.
    if (ok || (advice && (advice.kind === 'new-proposal' || advice.kind === 'refresh')))
      onChanged();
  }
  return (
    <section className="profile-card" aria-label="Decision">
      <h3 className="profile-section-title">
        {canDecide ? 'Review this correction' : 'Withdraw this correction'}
      </h3>
      <Field label={canDecide ? 'Your note (required)' : 'Why are you withdrawing it? (required)'}>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {canDecide && c.exceptionRequired ? (
        <Field label="Exception reason (required — older fact)">
          <textarea rows={2} value={exception} onChange={(e) => setException(e.target.value)} />
        </Field>
      ) : null}
      <FormError message={cmd.advice ? cmd.advice.message : cmd.error} />
      <div className="ops-actions">
        {canDecide ? (
          <>
            <button
              className="fin-btn fin-btn-primary"
              type="button"
              disabled={cmd.busy}
              onClick={() => run('approve')}
            >
              {cmd.busy
                ? 'Working…'
                : cmd.advice?.kind === 'retry-same-key'
                  ? 'Retry'
                  : 'Approve and apply'}
            </button>
            <button
              className="fin-btn"
              type="button"
              disabled={cmd.busy}
              onClick={() => run('reject')}
            >
              Reject
            </button>
          </>
        ) : null}
        {c.allowedActions.includes('withdraw') ? (
          <button
            className="fin-btn"
            type="button"
            disabled={cmd.busy}
            onClick={() => run('withdraw')}
          >
            Withdraw
          </button>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------- resident history panel

/** Corrections for one record, newest first. Used by the resident profile. Pending values are never shown here. */
export function CorrectionHistory({
  targetType,
  targetId,
}: {
  targetType: CorrectionTargetType;
  targetId: string;
}) {
  const [page, setPage] = useState(1);
  const query = useAsync(
    useCallback(
      () => opsApi.corrections.history(targetType, targetId, { page, limit: 10 }),
      [targetType, targetId, page],
    ),
    [targetType, targetId, page],
  );
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / query.data.limit)) : 1;
  return (
    <section className="profile-card" aria-labelledby={`corr-${targetId}`}>
      <h3 id={`corr-${targetId}`} className="profile-section-title">
        Corrections
      </h3>
      <p>
        <a href={correctionsLinks.new({ targetType, targetId })}>Request a correction</a>
      </p>
      {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      {query.loading && !query.data ? <LoadingState label="Loading corrections…" /> : null}
      {query.data && query.data.items.length === 0 ? (
        <EmptyState
          title="No corrections"
          hint="Corrections requested for this record appear here."
        />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <ul className="ops-list-plain">
          {query.data.items.map((c) => (
            <li key={c.id}>
              <a href={correctionsLinks.detail(c.id)}>{fieldLabel(c.fieldKey)}</a> —{' '}
              <StatusTag status={c.status} />{' '}
              <small>
                {formatWhen(c.recordedAt)} · {c.requester.displayName}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
      {totalPages > 1 ? <Pager page={page} totalPages={totalPages} onPage={setPage} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------- billing reviews

export function FinanceReviews() {
  const { state } = useAuth();
  const owner = state.status === 'authenticated' && state.user.role === 'OWNER';
  const [resolved, setResolved] = useState(false);
  const query = useAsync(
    useCallback(() => opsApi.corrections.financeReviews(resolved), [resolved]),
    [resolved],
  );
  return (
    <section aria-labelledby="fin-reviews-head">
      <PageHead title="Billing reviews" />
      <p className="fin-lede" id="fin-reviews-head">
        Corrections that may affect what is billed. Until an owner resolves one, no invoice is
        created or issued for that month automatically.
      </p>
      <label className="fin-field">
        <span>Show</span>
        <select
          value={resolved ? 'resolved' : 'open'}
          onChange={(e) => setResolved(e.target.value === 'resolved')}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      {query.error ? <ErrorState message={query.error} onRetry={query.reload} /> : null}
      {query.loading && !query.data ? <LoadingState label="Loading billing reviews…" /> : null}
      {query.data && query.data.items.length === 0 ? (
        <EmptyState title="Nothing to review" hint="No billing reviews match." />
      ) : null}
      {!owner && !resolved ? (
        <p className="fin-note">Only an independent owner can resolve a billing review.</p>
      ) : null}
      {query.data?.items.map((item) => (
        <ReviewRow
          key={item.id}
          item={item}
          canResolve={owner && !resolved}
          onChanged={query.reload}
        />
      ))}
    </section>
  );
}

function ReviewRow({
  item,
  canResolve,
  onChanged,
}: {
  item: FinanceReviewItem;
  canResolve: boolean;
  onChanged: () => void;
}) {
  const [outcome, setOutcome] = useState<'RELEASED' | 'NO_SUPPORTED_REMEDY'>('RELEASED');
  const [reason, setReason] = useState('');
  const cmd = useCommand();
  async function resolve() {
    if (reason.trim() === '') return cmd.setError('Write the reason for the record.');
    const { ok } = await cmd.send(
      commandSignature(['resolve', item.id, outcome, reason.trim()]),
      (key) =>
        opsApi.corrections.resolveFinanceReview(key, item.id, { outcome, reason: reason.trim() }),
    );
    if (ok) onChanged();
  }
  return (
    <div className="profile-card">
      <p>
        <strong>
          {item.kind === 'BILLING_GAP'
            ? `No invoice yet for ${item.periodStart ?? 'a month'}`
            : 'Issued invoice to review'}
        </strong>{' '}
        · from <a href={correctionsLinks.detail(item.proposalId)}>this correction</a>
        {item.invoiceId ? (
          <>
            {' '}
            · <a href={`#finance/invoices/${item.invoiceId}`}>invoice</a>
          </>
        ) : null}
      </p>
      {canResolve ? (
        <>
          <Field label="Decision">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as 'RELEASED' | 'NO_SUPPORTED_REMEDY')}
            >
              <option value="RELEASED">
                Release — a normal invoice may be created and issued by hand
              </option>
              <option value="NO_SUPPORTED_REMEDY">
                No supported remedy — record this and change nothing
              </option>
            </select>
          </Field>
          <Field label="Reason (required)">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FormError message={cmd.advice ? cmd.advice.message : cmd.error} />
          <button
            className="fin-btn fin-btn-primary"
            type="button"
            disabled={cmd.busy}
            onClick={resolve}
          >
            {cmd.busy ? 'Saving…' : 'Record decision'}
          </button>
        </>
      ) : null}
    </div>
  );
}
