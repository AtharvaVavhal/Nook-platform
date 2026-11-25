import { hrefs } from '../lib/route.js';
import { EmptyState } from '../ui/Feedback.js';
import { Card, PageHeader } from '../ui/Layout.js';

export function NotFoundPage() {
  return (
    <div className="rp-stack rp-stack--lg">
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon="info"
          title="We can't find that page"
          text="The link may be old or mistyped."
          action={
            <a className="rp-link" href={hrefs.home}>
              Go to Home
            </a>
          }
        />
      </Card>
    </div>
  );
}
