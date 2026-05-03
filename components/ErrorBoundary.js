import React from 'react';
import { useTranslations } from '../lib/i18n';

function ErrorFallback({ onReload, error, errorInfo }) {
  const t = useTranslations('components.errorBoundary');
  const [showDetails, setShowDetails] = React.useState(false);
  const errMessage = error?.message || String(error || 'Unknown');
  const errStack = error?.stack || '';
  const componentStack = errorInfo?.componentStack || '';

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full bg-surface border border-subtle rounded-2xl p-8">
        <h1 className="text-lg font-semibold text-primary mb-3 text-center">{t('title')}</h1>
        <p className="text-sm text-secondary mb-2 text-center">{t('message')}</p>

        <div className="mt-4 mb-4 bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 text-xs text-primary">
          <p className="font-mono text-danger break-words">{errMessage}</p>
        </div>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-[11px] text-secondary hover:text-primary underline mb-3"
        >
          {showDetails ? 'Details ausblenden' : 'Stack-Details zeigen'}
        </button>

        {showDetails && (
          <pre className="text-[10px] bg-hover-subtle border border-subtle rounded-lg p-3 overflow-auto max-h-64 mb-4 whitespace-pre-wrap break-words">
            {errStack}
            {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
          </pre>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={onReload}
            className="gradient-accent text-white px-5 py-2.5 rounded-full text-sm font-medium"
          >
            {t('reload')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (typeof console !== 'undefined') {
      console.error('UI error boundary captured an error', error, errorInfo);
    }
    this.setState({ errorInfo });
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          onReload={this.handleReload}
          error={this.state.error}
          errorInfo={this.state.errorInfo}
        />
      );
    }
    return this.props.children;
  }
}
