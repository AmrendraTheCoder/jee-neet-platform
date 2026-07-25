import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Rendered instead of the subtree when it throws. */
  readonly fallback: (error: Error, reset: () => void) => ReactNode;
  /** Reported to the incident pipeline. Never receives student answer data. */
  readonly onError?: (error: Error, componentStack: string) => void;
  /**
   * When this value changes the boundary resets. The attempt player passes the
   * current question id so a boundary tripped by one bad item does not keep
   * the next item from rendering.
   */
  readonly resetKey?: string;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * The generic boundary. `MathErrorBoundary` wraps this with the per-question
 * fallback FR-MTH-03 requires; this one is what the route tree and the admin
 * shell use.
 *
 * There is no top-level "something went wrong, reload" screen over the attempt
 * player, deliberately. A reload during a live paper costs a candidate real
 * seconds against an immovable deadline, so failures are contained as locally
 * as they can be and the surrounding player keeps working.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info.componentStack ?? '');
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) return this.props.fallback(error, this.reset);
    return this.props.children;
  }
}
