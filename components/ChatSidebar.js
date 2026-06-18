import { useState } from 'react';
import { Plus, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { useTranslations } from '../lib/i18n';

export default function ChatSidebar({ conversations, activeId, onSelect, onNew, onDelete, loading }) {
  const t = useTranslations('chatPage');
  const [deleteId, setDeleteId] = useState(null);

  const handleDelete = async (id) => {
    setDeleteId(id);
    try {
      await onDelete(id);
    } finally {
      setDeleteId(null);
    }
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  return (
    <div className="w-64 shrink-0 border-r border-subtle bg-surface flex flex-col h-full">
      <div className="p-3 border-b border-subtle">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold gradient-accent text-white transition-all hover:scale-[1.02] active:scale-100"
        >
          <Plus className="w-4 h-4" />
          {t('newChat')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-secondary">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-6 text-xs text-secondary text-center">{t('empty')}</p>
        ) : (
          <ul className="py-1">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <button
                  onClick={() => onSelect(conv)}
                  className={`w-full text-left px-3 py-3 flex items-start gap-2 transition-colors group ${
                    activeId === conv.id
                      ? 'bg-accent/10 border-r-2 border-accent'
                      : 'hover:bg-hover-subtle border-r-2 border-transparent'
                  }`}
                >
                  <MessageSquare className={`w-4 h-4 mt-0.5 shrink-0 ${activeId === conv.id ? 'text-accent' : 'text-secondary'}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${activeId === conv.id ? 'text-primary font-medium' : 'text-primary'}`}>
                      {conv.title || t('untitled')}
                    </p>
                    <p className="text-[10px] text-secondary mt-0.5">
                      {conv.message_count || 0} {t('messagesCount')} · {formatDate(conv.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}
                    disabled={deleteId === conv.id}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-secondary hover:text-danger"
                    title={t('deleteChat')}
                  >
                    {deleteId === conv.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}