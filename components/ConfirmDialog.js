import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useTranslations } from '../lib/i18n';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const t = useTranslations('confirmDialog');
  const resolvedTitle = title ?? t('title');
  const resolvedMessage = message ?? t('message');
  const resolvedConfirm = confirmLabel ?? t('confirmLabel');
  const resolvedCancel = cancelLabel ?? t('cancelLabel');

  const handleOpenChange = (next) => {
    if (!next && !busy) onCancel?.();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolvedTitle}</AlertDialogTitle>
          <AlertDialogDescription>{resolvedMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>
            {resolvedCancel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            variant={danger ? 'destructive' : 'default'}
            onClick={(event) => {
              // Prevent Radix from auto-closing before async work — caller controls `open`.
              event.preventDefault();
              onConfirm?.();
            }}
          >
            {resolvedConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
