import { useState, useRef, useCallback } from 'react';
import { Send, Loader2, Upload } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

export default function ChatInput({ onSend, disabled, leading = null, onUpload = null }) {
  const t = useTranslations('chatPage');
  const [value, setValue] = useState('');
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef(null);
  const dragDepth = useRef(0);

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

  const handleDragOver = useCallback((e) => {
    if (!onUpload || disabled) return;
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      e.preventDefault();
    }
  }, [onUpload, disabled]);

  const handleDragEnter = useCallback((e) => {
    if (!onUpload || disabled) return;
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      dragDepth.current += 1;
      setDragging(true);
    }
  }, [onUpload, disabled]);

  const handleDragLeave = useCallback(() => {
    if (!onUpload) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, [onUpload]);

  const handleDrop = useCallback((e) => {
    if (!onUpload || disabled) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload(file);
  }, [onUpload, disabled]);

  const handlePaste = useCallback((e) => {
    if (!onUpload || disabled) return;
    const file = e.clipboardData?.files?.[0];
    if (file) {
      e.preventDefault();
      onUpload(file);
    }
  }, [onUpload, disabled]);

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex items-end gap-2 p-3 border-t border-subtle bg-surface"
    >
      {dragging && (
        <div className="absolute inset-1 z-10 rounded-xl border-2 border-dashed border-accent/60 bg-surface/90 flex items-center justify-center gap-2 text-sm text-accent pointer-events-none">
          <Upload className="w-4 h-4" />
          <span>{t('dropToUpload')}</span>
        </div>
      )}
      {leading}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
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
