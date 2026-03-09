import { useCallback, useEffect, useRef, useState } from 'react';

export function useUiFeedback() {
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const confirmResolverRef = useRef(null);

  const showToast = useCallback((message, type = 'info') => {
    if (!message) return;
    setToast({ message, type });
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
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
    toast,
    showToast,
    clearToast,
    confirmDialog,
    confirm,
    closeConfirm,
    acceptConfirm,
  };
}
