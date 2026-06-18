import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useCallback, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { MessageSquare, Bot, ArrowRight } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import ChatSidebar from '../components/ChatSidebar';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';
import ChatContextBar from '../components/ChatContextBar';
import { useTranslations } from '../lib/i18n';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

/**
 * POST to the SSE chat endpoint and parse the event stream. Calls
 * `onDelta(text)` for each token and resolves with the final stored message
 * from the `done` event. Throws on HTTP errors (with `.status`) or `error`
 * events so the caller can decide whether to fall back to the non-streaming
 * endpoint.
 */
async function streamChatRequest(conversationId, message, onDelta) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalMessage = null;
  let finalTitle = null;
  let streamError = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = 'message';
      let dataStr = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
      }
      if (!dataStr) continue;
      let payload;
      try { payload = JSON.parse(dataStr); } catch { continue; }
      if (eventName === 'delta') onDelta(payload.content || '');
      else if (eventName === 'done') { finalMessage = payload.message; finalTitle = payload.conversationTitle || null; }
      else if (eventName === 'error') streamError = new Error(payload.message || 'stream error');
    }
  }

  if (streamError) throw streamError;
  if (!finalMessage) throw new Error('Kein Ergebnis vom Stream');
  return { message: finalMessage, title: finalTitle };
}

export default function ChatPage() {
  const router = useRouter();
  const { status } = useSession();
  const t = useTranslations('chatPage');
  const tNav = useTranslations('nav');

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [contextItems, setContextItems] = useState([]);
  const [error, setError] = useState('');

  const scrollRef = useRef(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login?next=/chat');
    }
  }, [status, router]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchJson('/api/chat/conversations');
      setConversations(data.conversations || []);
    } catch {
      setConversations([]);
    } finally {
      setConvLoading(false);
    }
  }, []);

  const loadContext = useCallback(async (convId) => {
    try {
      const data = await fetchJson(`/api/chat/context?conversationId=${convId}`);
      setContextItems(data.items || []);
    } catch {
      setContextItems([]);
    }
  }, []);

  const loadMessages = useCallback(async (convId) => {
    setMsgLoading(true);
    setError('');
    setContextItems([]);
    try {
      const data = await fetchJson(`/api/chat?conversationId=${convId}`);
      setConversation(data.conversation);
      setMessages(data.messages || []);
      loadContext(convId);
    } catch (err) {
      setError(err.message || t('loadError'));
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }, [t, loadContext]);

  const handleAddContext = useCallback(async (context) => {
    if (!activeId) return;
    const payload = typeof context === 'object' && context !== null
      ? { conversationId: activeId, ...context }
      : { conversationId: activeId, contextType: 'document', documentId: context };
    try {
      const data = await fetchJson('/api/chat/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setContextItems(data.items || []);
    } catch (err) {
      setError(err.message || t('sendError'));
    }
  }, [activeId, t]);

  const handleRemoveContext = useCallback(async (context) => {
    if (!activeId) return;
    const params = new URLSearchParams({ conversationId: String(activeId) });
    if (context?.context_type === 'knowledge_base') {
      params.set('contextType', 'knowledge_base');
      params.set('knowledgeBaseId', String(context.knowledge_base_id));
    } else {
      params.set('contextType', 'document');
      params.set('documentId', String(context?.document_id ?? context));
    }
    try {
      const data = await fetchJson(`/api/chat/context?${params.toString()}`, { method: 'DELETE' });
      setContextItems(data.items || []);
    } catch (err) {
      setError(err.message || t('sendError'));
    }
  }, [activeId, t]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadConversations();
    }
  }, [status, loadConversations]);

  useEffect(() => {
    if (initialLoadDone.current) return;
    const { source, refId } = router.query;

    if (source && refId && status === 'authenticated' && conversations.length >= 0) {
      if (conversations.length > 0) {
        const existing = conversations.find(
          (c) => c.context_source === source && c.context_ref_id === Number(refId),
        );
        if (existing) {
          setActiveId(existing.id);
          loadMessages(existing.id);
          initialLoadDone.current = true;
          return;
        }
      }
      createConversation(source, Number(refId)).then((id) => {
        if (id) {
          setActiveId(id);
          loadMessages(id);
        }
      });
      initialLoadDone.current = true;
      return;
    }

    const storedText = sessionStorage.getItem('chat:context:text');
    const storedSource = sessionStorage.getItem('chat:context:source');
    const storedTitle = sessionStorage.getItem('chat:context:title');
    if (storedText && storedSource && status === 'authenticated' && conversations.length >= 0) {
      sessionStorage.removeItem('chat:context:text');
      sessionStorage.removeItem('chat:context:source');
      sessionStorage.removeItem('chat:context:title');
      fetchJson('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: storedTitle || null,
          contextSource: storedSource,
          contextRefId: null,
          _contextSnapshotText: storedText,
        }),
      }).then((data) => {
        if (data?.conversation) {
          setConversations((prev) => [data.conversation, ...prev]);
          setActiveId(data.conversation.id);
          loadMessages(data.conversation.id);
        }
      }).catch(() => {});
      initialLoadDone.current = true;
      return;
    }

    initialLoadDone.current = true;
  }, [status, conversations, router.query, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const createConversation = async (contextSource, contextRefId) => {
    try {
      const data = await fetchJson('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextSource, contextRefId }),
      });
      setConversations((prev) => [data.conversation, ...prev]);
      return data.conversation.id;
    } catch {
      return null;
    }
  };

  const handleNewChat = async () => {
    try {
      const data = await fetchJson('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t('newChatDefault') }),
      });
      setConversations((prev) => [data.conversation, ...prev]);
      setActiveId(data.conversation.id);
      setMessages([]);
      setContextItems([]);
      setConversation(data.conversation);
      router.replace('/chat', undefined, { shallow: true });
    } catch {
      setError(t('createError'));
    }
  };

  const handleSelect = (conv) => {
    setActiveId(conv.id);
    loadMessages(conv.id);
    router.replace('/chat', undefined, { shallow: true });
  };

  const handleDelete = async (id) => {
    try {
      await fetchJson(`/api/chat/conversations?id=${id}`, { method: 'DELETE' });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setConversation(null);
      }
    } catch {
      setError(t('deleteError'));
    }
  };

  const bumpConversation = useCallback((id, newTitle = null) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id
        ? { ...c, updated_at: new Date().toISOString(), message_count: (c.message_count || 0) + 2, ...(newTitle ? { title: newTitle } : {}) }
        : c)),
    );
    if (newTitle) {
      setConversation((prev) => (prev && prev.id === id ? { ...prev, title: newTitle } : prev));
    }
  }, []);

  const handleSend = async (message) => {
    if (!activeId) return;
    const convId = activeId;
    setSending(true);
    setError('');
    const optimisticUser = { id: `user-${Date.now()}`, role: 'user', content: message, created_at: new Date().toISOString() };
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, optimisticUser]);

    const appendDelta = (delta) => {
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === assistantId);
        if (existing) {
          return prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
        }
        return [...prev, { id: assistantId, role: 'assistant', content: delta, streaming: true, created_at: new Date().toISOString() }];
      });
    };

    try {
      const { message: finalMessage, title: newTitle } = await streamChatRequest(convId, message, appendDelta);
      setMessages((prev) => {
        const withoutPlaceholder = prev.filter((m) => m.id !== assistantId);
        return [...withoutPlaceholder, finalMessage];
      });
      bumpConversation(convId, newTitle);
    } catch (streamErr) {
      // Fall back to the non-streaming endpoint only when the stream endpoint
      // is unavailable (network error or 404) — nothing was persisted yet in
      // those cases, so a clean retry won't duplicate the user message.
      const canFallback = !streamErr.status || streamErr.status === 404;
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      if (canFallback) {
        try {
          const data = await fetchJson('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: convId, message }),
          });
          setMessages((prev) => [...prev, data.message]);
          bumpConversation(convId);
        } catch (err) {
          setError(err.message || t('sendError'));
          setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
        }
      } else {
        setError(streamErr.message || t('sendError'));
      }
    } finally {
      setSending(false);
    }
  };

  const handleCopyMessage = useCallback(async (message) => {
    try {
      await navigator.clipboard.writeText(message.content || '');
    } catch {
      setError(t('copyError'));
    }
  }, [t]);

  const handleRegenerateMessage = useCallback(async (message) => {
    if (!message?.id || sending) return;
    setSending(true);
    setError('');
    try {
      const data = await fetchJson('/api/chat/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id }),
      });
      setMessages((prev) => [...prev.filter((m) => m.id !== message.id), data.message]);
    } catch (err) {
      setError(err.message || t('sendError'));
    } finally {
      setSending(false);
    }
  }, [sending, t]);

  const handleEditMessage = useCallback(async (message, content) => {
    if (!message?.id || sending) return;
    setSending(true);
    setError('');
    try {
      const data = await fetchJson(`/api/chat/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => {
        const index = prev.findIndex((m) => m.id === message.id);
        const kept = index >= 0 ? prev.slice(0, index) : prev;
        return [...kept, data.userMessage, data.message];
      });
      bumpConversation(activeId);
    } catch (err) {
      setError(err.message || t('sendError'));
    } finally {
      setSending(false);
    }
  }, [activeId, bumpConversation, sending, t]);

  if (status === 'loading') return <LoadingSpinner />;
  if (status === 'unauthenticated') return <LoadingSpinner />;

  const contextLabel = conversation?.context_source === 'ocr' ? t('contextOcr')
    : conversation?.context_source === 'translate' ? t('contextTranslate')
    : conversation?.context_source === 'textoptimization' ? t('contextTextopt')
    : conversation?.context_source === 'transcription' ? t('contextTranscription')
    : null;

  return (
    <>
      <Head>
        <title>{`${tNav('chat')} – GhostTyper`}</title>
      </Head>
      <div className="flex h-[calc(100vh-8rem)] overflow-hidden -mx-4 sm:-mx-6">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNewChat}
          onDelete={handleDelete}
          loading={convLoading}
        />
        <div className="flex-1 flex flex-col min-w-0">
          {activeId ? (
            <>
              {conversation?.context_snapshot && contextLabel && (
                <div className="px-4 py-2 bg-accent/5 border-b border-subtle text-xs text-secondary flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-accent" />
                  <span>{t('contextBanner', { label: contextLabel, title: conversation.title || '' })}</span>
                </div>
              )}
              <ChatContextBar
                items={contextItems}
                onAdd={handleAddContext}
                onRemove={handleRemoveContext}
                disabled={sending}
              />
              {error && (
                <div className="px-4 py-2 bg-danger/10 border-b border-danger/20 text-danger text-xs">{error}</div>
              )}
              <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
                {msgLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <LoadingSpinner size="sm" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-secondary">
                    <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">{t('startConversation')}</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg, index) => (
                      <ChatMessage
                        key={msg.id}
                        message={msg}
                        disabled={sending}
                        showFollowups={index === messages.length - 1 && msg.role === 'assistant' && !msg.streaming}
                        onCopy={handleCopyMessage}
                        onRegenerate={index === messages.length - 1 ? handleRegenerateMessage : null}
                        onEdit={handleEditMessage}
                        onFollowup={handleSend}
                      />
                    ))}
                    {sending && !messages.some((m) => m.streaming) && (
                      <div className="flex gap-3">
                        <div className="shrink-0 w-8 h-8 rounded-full bg-subtle flex items-center justify-center">
                          <Bot className="w-4 h-4 text-secondary" />
                        </div>
                        <div className="bg-surface-elevated border border-subtle rounded-2xl rounded-bl-md px-4 py-3">
                          <div className="flex gap-1.5">
                            <span className="w-2 h-2 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2 h-2 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2 h-2 bg-secondary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <ChatInput onSend={handleSend} disabled={sending} />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="w-16 h-16 rounded-2xl gradient-accent flex items-center justify-center mb-5 shadow-lg shadow-accent/20">
                <MessageSquare className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-xl font-bold text-primary mb-2">{t('welcomeTitle')}</h1>
              <p className="text-sm text-secondary max-w-md mb-6">{t('welcomeHint')}</p>
              <button
                onClick={handleNewChat}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold gradient-accent text-white transition-all hover:scale-[1.02] active:scale-100 shadow-lg shadow-accent/20"
              >
                {t('startNewChat')} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
