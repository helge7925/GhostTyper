import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '../../lib/theme-context';

export function Toaster(props) {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast bg-surface text-primary border border-subtle shadow-lg rounded-xl',
          description: 'text-secondary text-xs',
          actionButton: 'bg-accent text-white',
          cancelButton: 'bg-hover-subtle text-secondary',
        },
      }}
      {...props}
    />
  );
}
