import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/** Catches render errors so the desktop/browser shell is not a blank page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Error inesperado' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI crash', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="app-shell" role="alert">
          <div className="dialog" style={{ margin: '4rem auto', maxWidth: 420 }}>
            <h1>Algo falló en la interfaz</h1>
            <p className="muted">{this.state.message}</p>
            <div className="dialog__actions">
              <button type="button" className="button" onClick={this.handleRetry}>
                Reintentar
              </button>
            </div>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
