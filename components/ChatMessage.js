import { useMemo, useState } from 'react';
import Link from 'next/link';
import { User, Bot, FileText, Copy, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { useFormatter, useTranslations } from '../lib/i18n';
import { buildFollowupPrompts } from '../lib/chat-actions-utils';

function parseRetrievalSources(metadata) {
  let meta = metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return []; }
  }
  const sources = meta?.retrieval_results;
  if (!Array.isArray(sources)) return [];
  // De-duplicate by document so multiple chunks of the same file show once.
  const seen = new Map();
  for (const s of sources) {
    const key = s.documentId ?? s.transcriptionId ?? s.id;
    if (key != null && !seen.has(key)) seen.set(key, s);
  }
  return Array.from(seen.values());
}

function mdToSimpleHtml(md) {
  const escaped = String(md || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-subtle px-1 py-0.5 rounded text-xs">$1</code>')
    .replace(/\n/g, '<br>');
}

export default function ChatMessage({ message, onCopy, onRegenerate, onEdit, onFollowup, disabled = false, showFollowups = false }) {
  const formatter = useFormatter();
  const t = useTranslations('chatPage');
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content || '');
  const html = useMemo(() => mdToSimpleHtml(message.content), [message.content]);
  const sources = useMemo(
    () => (isUser ? [] : parseRetrievalSources(message.metadata)),
    [isUser, message.metadata],
  );
  const time = useMemo(() => {
    if (!message.created_at) return '';
    return formatter.dateTime.format(new Date(message.created_at));
  }, [message.created_at, formatter]);
  const followups = useMemo(() => (showFollowups && !isUser ? buildFollowupPrompts(message) : []), [showFollowups, isUser, message]);

  const saveEdit = () => {
    const next = draft.trim();
    if (!next || next === message.content) {
      setEditing(false);
      setDraft(message.content || '');
      return;
    }
    onEdit?.(message, next);
    setEditing(false);
  };

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs ${
        isUser ? 'bg-accent/20 text-accent' : 'bg-subtle text-secondary'
      }`}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div className={`max-w-[80%] min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'gradient-accent text-white rounded-br-md'
            : 'bg-surface-elevated border border-subtle text-primary rounded-bl-md'
        }`}>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                className="w-full min-w-[260px] bg-white/10 border border-white/30 rounded-lg px-3 py-2 text-sm text-white outline-none resize-y placeholder:text-white/60"
              />
              <div className="flex justify-end gap-1">
                <button type="button" onClick={() => { setEditing(false); setDraft(message.content || ''); }} className="p-1 rounded-md hover:bg-white/10" aria-label={t('cancelEdit')}>
                  <X className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={saveEdit} className="p-1 rounded-md hover:bg-white/10" aria-label={t('saveEdit')}>
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
        {!message.streaming && !editing && (
          <div className={`mt-1 flex gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <button type="button" disabled={disabled} onClick={() => onCopy?.(message)} className="p-1 rounded-md text-secondary hover:text-primary hover:bg-subtle disabled:opacity-40" aria-label={t('copyMessage')}>
              <Copy className="w-3.5 h-3.5" />
            </button>
            {isUser && (
              <button type="button" disabled={disabled} onClick={() => setEditing(true)} className="p-1 rounded-md text-secondary hover:text-primary hover:bg-subtle disabled:opacity-40" aria-label={t('editMessage')}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {!isUser && (
              <button type="button" disabled={disabled} onClick={() => onRegenerate?.(message)} className="p-1 rounded-md text-secondary hover:text-primary hover:bg-subtle disabled:opacity-40" aria-label={t('regenerateMessage')}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        {sources.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium text-secondary">{t('sources')}</span>
            {sources.map((src, i) => {
              const label = src.title || t('sourceFallback', { index: i + 1 });
              const href = src.transcriptionId ? `/transcriptions/${src.transcriptionId}` : null;
              const chipClass = 'inline-flex items-center gap-1 max-w-[200px] px-2 py-0.5 rounded-full bg-subtle text-secondary text-[10px] border border-subtle';
              const inner = (
                <>
                  <FileText className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </>
              );
              return href ? (
                <Link key={src.id ?? i} href={href} className={`${chipClass} hover:text-accent hover:border-accent/40 transition-colors`} title={label}>
                  {inner}
                </Link>
              ) : (
                <span key={src.id ?? i} className={chipClass} title={label}>{inner}</span>
              );
            })}
          </div>
        )}
        {time && (
          <p className={`text-[10px] text-secondary mt-1 ${isUser ? 'text-right' : 'text-left'}`}>{time}</p>
        )}
        {followups.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {followups.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={disabled}
                onClick={() => onFollowup?.(prompt)}
                className="px-2 py-1 rounded-full border border-subtle bg-surface text-[11px] text-secondary hover:text-accent hover:border-accent/40 disabled:opacity-40"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
