import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    if (typeof console !== 'undefined') {
      console.error('UI error boundary captured an error', error);
    }
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[70vh] flex items-center justify-center px-4">
          <div className="max-w-md w-full bg-surface border border-subtle rounded-2xl p-8 text-center">
            <h1 className="text-lg font-semibold text-primary mb-3">Unerwarteter Fehler</h1>
            <p className="text-sm text-secondary mb-6">
              Die Ansicht konnte nicht geladen werden. Bitte Seite neu laden.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="gradient-accent text-white px-5 py-2.5 rounded-full text-sm font-medium"
            >
              Neu laden
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
