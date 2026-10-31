import { Link } from '../router/RouterContext';
import { Icon } from './BrandIllustration';

interface ErrorStateProps {
  type: 'forbidden' | 'not-found' | 'conflict' | 'rule-not-configured' | 'generic';
  title?: string;
  message?: string;
  ruleName?: string;
  actionText?: string;
  actionHref?: string;
  onRetry?: () => void;
}

export function ErrorState({
  type,
  title,
  message,
  ruleName,
  actionText,
  actionHref = '#/overview',
  onRetry,
}: ErrorStateProps) {
  if (type === 'rule-not-configured') {
    return (
      <section className="state-card state-rule-error" role="alert" aria-live="assertive">
        <div className="state-icon-wrap warning">
          <Icon name="search" size={32} />
        </div>
        <div className="state-content">
          <span className="environment-badge warning">RULE NOT CONFIGURED</span>
          <h2>{title || 'Business rule not configured'}</h2>
          <p>
            {message ||
              'This calculation or allocation cannot proceed because the required operational rule has not been configured by the property administrator.'}
          </p>
          {ruleName && (
            <div className="rule-pill-box">
              <span>Unconfigured rule identifier:</span>
              <code>{ruleName}</code>
            </div>
          )}
          <p className="state-guidance">
            No manual override or estimated workaround is permitted by Nook guardrails. Please contact the property owner.
          </p>
        </div>
      </section>
    );
  }

  if (type === 'conflict') {
    return (
      <section className="state-card state-conflict" role="alert" aria-live="assertive">
        <div className="state-icon-wrap danger">
          <Icon name="bed" size={32} />
        </div>
        <div className="state-content">
          <span className="environment-badge danger">ALLOCATION CONFLICT</span>
          <h2>{title || 'This bed is no longer available'}</h2>
          <p>
            {message ||
              'Another operator or resident completed an allocation for this bed moments ago. Selecting a bed does not hold it.'}
          </p>
          <div className="state-actions">
            <Link to="#/floor-plan" className="primary-button">
              Return to floor plan <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (type === 'forbidden') {
    return (
      <section className="state-card state-forbidden" role="alert">
        <div className="state-icon-wrap neutral">
          <Icon name="close" size={32} />
        </div>
        <div className="state-content">
          <span className="environment-badge">ACCESS RESTRICTED (403)</span>
          <h2>{title || 'Permission required'}</h2>
          <p>
            {message ||
              'Your current role does not hold the permission required to access this workspace module.'}
          </p>
          <div className="state-actions">
            <Link to="#/overview" className="outline-button">
              Return to overview
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (type === 'not-found') {
    return (
      <section className="state-card state-not-found" role="alert">
        <div className="state-icon-wrap neutral">
          <Icon name="search" size={32} />
        </div>
        <div className="state-content">
          <span className="environment-badge">NOT FOUND (404)</span>
          <h2>{title || 'Resource not found'}</h2>
          <p>
            {message ||
              'The requested property, resident, or transaction record could not be found in this workspace.'}
          </p>
          <div className="state-actions">
            <Link to="#/overview" className="outline-button">
              Return to overview
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="state-card state-generic-error" role="alert">
      <div className="state-icon-wrap danger">
        <Icon name="close" size={32} />
      </div>
      <div className="state-content">
        <h2>{title || 'Unable to complete request'}</h2>
        <p>{message || 'An unexpected issue occurred while communicating with the server.'}</p>
        <div className="state-actions">
          {onRetry ? (
            <button type="button" className="primary-button" onClick={onRetry}>
              Try again
            </button>
          ) : (
            <Link to={actionHref} className="primary-button">
              {actionText || 'Back to overview'}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
