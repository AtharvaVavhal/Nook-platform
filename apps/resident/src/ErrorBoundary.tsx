import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/Button.js';
import { EmptyState } from './ui/Feedback.js';

/** A rendering bug shows a calm recovery screen instead of a blank page. Nothing about the error is shown to the resident. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Development aid only; the production message below carries no detail.
    if (import.meta.env?.DEV) console.error(error, info.componentStack);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}
        role="alert"
      >
        <EmptyState
          icon="alert"
          title="Something went wrong"
          text="This page could not be shown. Reloading usually fixes it."
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      </div>
    );
  }
}
