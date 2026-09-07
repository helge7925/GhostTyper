import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import LoadingSpinner from '../../components/LoadingSpinner';
import ConfirmDialog from '../../components/ConfirmDialog';
import Toast from '../../components/Toast';
import { useUiFeedback } from '../../lib/use-ui-feedback';
import { useFormatter, useTranslations } from '../../lib/i18n';
import { deleteDocument, getDocument, updateDocument } from '../../lib/api';

export default function DocumentDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const { status } = useSession();
  const t = useTranslations('documentDetail');
  const tCommon = useTranslations('common');
  const { dateTime } = useFormatter();
  const { toast, showToast, clearToast, confirmDialog, confirm, acceptConfirm, closeConfirm } = useUiFeedback();

  // Named `doc`, not `document`: the previous name shadowed the global inside
  // every handler on this page.
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDoc(await getDocument(id));
    } catch (error) {
      showToast(error.message || t('loadFailed'), 'error');
      setDoc(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast, t]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated') load();
  }, [status, router, load]);

  const openTagDialog = useCallback(() => {
    setTagInput(Array.isArray(doc?.tags) ? doc.tags.join(', ') : '');
    setTagDialogOpen(true);
  }, [doc]);

  const saveTags = useCallback(async () => {
    const tags = tagInput.split(',').map((tag) => tag.trim()).filter(Boolean);
    setTagDialogOpen(false);
    try {
      setDoc(await updateDocument(doc.id, { tags }));
    } catch (error) {
      showToast(error.message || t('tagsSaveFailed'), 'error');
    }
  }, [doc, showToast, t, tagInput]);

  const remove = useCallback(async () => {
    const approved = await confirm({
      title: t('deleteTitle'),
      message: t('deleteMessage'),
      confirmLabel: t('deleteConfirm'),
      danger: true,
    });
    if (!approved) return;
    setBusy(true);
    try {
      await deleteDocument(doc.id);
      router.push('/transcriptions');
    } catch (error) {
      showToast(error.message || t('deleteFailed'), 'error');
      setBusy(false);
    }
  }, [confirm, doc, router, showToast, t]);

  if (status === 'loading' || loading) return <LoadingSpinner />;
  if (!doc) return <LoadingSpinner />;

  const title = doc.title || doc.original_name || t('untitled', { id: doc.id });
  const body = doc.text || doc.summary || doc.text_preview || t('noPreview');

  return (
    <>
      <Head><title>{`${title} - GhostTyper`}</title></Head>
      <div className="max-w-6xl mx-auto animate-fade-in pb-20">
        <button onClick={() => router.push('/transcriptions')} className="text-secondary hover:text-primary text-xs mb-6">{t('back')}</button>
        <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-primary">{title}</h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-secondary">
                <span>{doc.source_type}</span>
                <span>{doc.visibility === 'private' ? t('private') : t('workspace')}</span>
                <span>{doc.updated_at ? dateTime.format(new Date(doc.updated_at)) : '-'}</span>
              </div>
              {Array.isArray(doc.tags) && doc.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {doc.tags.map((tag) => <span key={tag} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent-ink text-xs">#{tag}</span>)}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {doc.transcription_id && <Link href={`/transcriptions/${doc.transcription_id}`} className="px-3 py-2 rounded-lg bg-accent-strong text-white text-xs font-semibold">{t('openTranscript')}</Link>}
              <button type="button" onClick={openTagDialog} className="px-3 py-2 rounded-lg border border-subtle text-xs text-primary">{t('tags')}</button>
              <button type="button" disabled={busy} onClick={remove} className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs font-semibold disabled:opacity-50">{tCommon('delete')}</button>
            </div>
          </div>
        </div>
        <div className="bg-surface border border-subtle rounded-2xl p-6 shadow-xl">
          <h2 className="text-xs font-bold text-primary uppercase tracking-widest opacity-60 mb-4">{t('preview')}</h2>
          <div className="text-sm text-secondary leading-relaxed whitespace-pre-wrap max-h-[65vh] overflow-y-auto custom-scrollbar">{body}</div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        cancelLabel={confirmDialog?.cancelLabel}
        danger={confirmDialog?.danger}
        onConfirm={acceptConfirm}
        onCancel={closeConfirm}
      />

      {/* Same shape the bulk tag dialog on the library page uses — a native
          window.prompt here could not be styled, themed or translated, and was
          the only place in the app that still opened one. */}
      <ConfirmDialog
        open={tagDialogOpen}
        title={t('tagsDialogTitle')}
        message={(
          <div className="space-y-2">
            <label htmlFor="document-tags" className="text-xs text-secondary uppercase tracking-widest font-bold">
              {t('tagsLabel')}
            </label>
            <input
              id="document-tags"
              type="text"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder={t('tagsPlaceholder')}
              className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary"
            />
          </div>
        )}
        confirmLabel={t('tagsSave')}
        cancelLabel={tCommon('cancel')}
        onConfirm={saveTags}
        onCancel={() => setTagDialogOpen(false)}
      />
    </>
  );
}
