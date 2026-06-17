import { useMemo } from 'react';
import { User, Bot } from 'lucide-react';
import { useFormatter } from '../lib/i18n';

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

export default function ChatMessage({ message }) {
  const formatter = useFormatter();
  const isUser = message.role === 'user';
  const html = useMemo(() => mdToSimpleHtml(message.content), [message.content]);
  const time = useMemo(() => {
    if (!message.created_at) return '';
    return formatter.dateTime.format(new Date(message.created_at));
  }, [message.created_at, formatter]);

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
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        {time && (
          <p className={`text-[10px] text-secondary mt-1 ${isUser ? 'text-right' : 'text-left'}`}>{time}</p>
        )}
      </div>
    </div>
  );
}