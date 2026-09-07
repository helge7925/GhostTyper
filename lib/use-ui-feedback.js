import { useCallback, useEffect, useRef, useState } from 'react';
import { toast as sonnerToast } from 'sonner';

export function useUiFeedback() {
  const [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolverRef = useRef(null);

  // Goes to the sonner toaster mounted once in pages/_app.js. There used to be
  // two toast systems side by side — a locally rendered components/Toast.js and
  // sonner — so the same kind of feedback appeared bottom-left on one page and
  // top-right on another, with different durations and no close button on one
  // of them. Callers no longer render anything of their own.
  const showToast = useCallback((message, type = 'info') => {
    if (!message) return;
    if (type === 'error') sonnerToast.error(message);
    else if (type === 'success') sonnerToast.success(message);
    else sonnerToast(message);
  }, []);

  const confirm = useCallback((options = {}) => (
    new Promise((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        title: options.title || 'Bitte bestätigen',
        message: options.message || 'Möchten Sie fortfahren?',
        confirmLabel: options.confirmLabel || 'Bestätigen',
        cancelLabel: options.cancelLabel || 'Abbrechen',
        danger: Boolean(options.danger),
      });
    })
  ), []);

  const resolveConfirm = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    if (resolver) resolver(result);
  }, []);

  const closeConfirm = useCallback(() => resolveConfirm(false), [resolveConfirm]);
  const acceptConfirm = useCallback(() => resolveConfirm(true), [resolveConfirm]);

  useEffect(() => () => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
      confirmResolverRef.current = null;
    }
  }, []);

  return {
    showToast,
    confirmDialog,
    confirm,
    closeConfirm,
    acceptConfirm,
  };
}
