// Full-page explicit error panel — a failing screen must NEVER be blank.

import type { ReactNode } from 'react';
import { Component } from 'react';

export function ErrorPanel({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="viewer-error" role="alert">
      <h2>{title}</h2>
      {detail && <pre>{detail}</pre>}
    </div>
  );
}

/** Per-screen error boundary: a crashing screen becomes an ErrorPanel. */
export class ScreenErrorBoundary extends Component<
  { screenId: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`screen '${this.props.screenId}' crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorPanel
          title={`Screen '${this.props.screenId}' crashed`}
          detail={this.state.error.message}
        />
      );
    }
    return this.props.children;
  }
}
