import { useState, useRef, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

export default function ChatInput({ onSend, disabled }) {
  const t = useTranslations('chatPage');
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const handleInput = useCallback((e) => {
    setValue(e.target.value);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3 border-t border-subtle bg-surface">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={t('inputPlaceholder')}
        rows={1}
        className="flex-1 bg-surface-elevated border border-subtle rounded-xl px-4 py-3 text-sm text-primary outline-none resize-none focus:border-accent disabled:opacity-50 placeholder:text-secondary"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="shrink-0 w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center disabled:opacity-40 transition-opacity"
      >
        {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      </button>
    </form>
  );
}