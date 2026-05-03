import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import LoadingSpinner from '../components/LoadingSpinner';
import { useTranslations } from '../lib/i18n';

export default function Profile() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const fileInputRef = useRef(null);
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    avatarUrl: '',
    currentPassword: '',
    password: '',
    confirmPassword: ''
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated') {
      fetch('/api/user/profile')
        .then(res => res.json())
        .then(data => {
          setFormData(prev => ({
            ...prev,
            name: data.name || '',
            email: data.email || '',
            avatarUrl: data.avatar_url || ''
          }));
          setLoading(false)
        })
        .catch(() => setLoading(false));
    }
  }, [status, router]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('Das Bild ist zu groß (max. 2 MB).');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData(prev => ({ ...prev, avatarUrl: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (formData.password) {
      if (!formData.currentPassword) {
        setError('Bitte geben Sie Ihr aktuelles Passwort ein.');
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Die neuen Passwörter stimmen nicht überein.');
        return;
      }
    }

    setSaving(true);

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          avatarUrl: formData.avatarUrl,
          password: formData.password || undefined,
          currentPassword: formData.currentPassword || undefined
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setSuccess('Profil erfolgreich aktualisiert.');
      setFormData(prev => ({ ...prev, currentPassword: '', password: '', confirmPassword: '' }));
      
      await update();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || loading) return <LoadingSpinner />;

  return (
    <>
      <Head>
        <title>{`${t('title')} – GhostTyper`}</title>
      </Head>

      <div className="max-w-2xl mx-auto animate-fade-in">
        <h1 className="text-2xl font-bold text-primary mb-8">{t('title')}</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Avatar Section */}
          <div className="bg-surface border border-subtle rounded-2xl p-8 flex flex-col items-center text-center">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
            
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="relative cursor-pointer group"
            >
              {formData.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={formData.avatarUrl} 
                  alt="Avatar" 
                  className="w-32 h-32 rounded-full object-cover border-4 border-accent/20 group-hover:border-accent/50 transition-all shadow-2xl" 
                />
              ) : (
                <div className="w-32 h-32 rounded-full gradient-accent flex items-center justify-center text-4xl font-bold text-white uppercase shadow-2xl shadow-accent/20 group-hover:scale-105 transition-transform">
                  {formData.email.substring(0, 2)}
                </div>
              )}
              
              <div className="absolute inset-0 bg-overlay rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>
            
            <h2 className="mt-4 text-sm font-semibold text-primary uppercase tracking-widest">Profilbild ändern</h2>
            <p className="text-[10px] text-secondary mt-1">Klicke auf das Bild, um ein neues Foto hochzuladen</p>
          </div>

          {/* Account Info */}
          <div className="bg-surface border border-subtle rounded-2xl p-6 space-y-4 shadow-xl">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wider mb-2">Account-Informationen</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">{t('name')}</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">{t('email')}</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="bg-surface border border-subtle rounded-2xl p-6 space-y-4 shadow-xl">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wider mb-2">Passwort ändern</h2>
            
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">{t('currentPassword')}</label>
              <input
                type="password"
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                placeholder="Zur Bestätigung erforderlich"
                className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-subtle pt-4">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">{t('newPassword')}</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Min. 8 Zeichen"
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">{t('confirmPassword')}</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Passwort wiederholen"
                  className="w-full bg-surface-elevated border border-subtle rounded-lg px-3 py-2 text-sm text-primary focus:ring-1 focus:ring-accent outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-danger/10 border border-danger/20 text-danger rounded-xl text-sm animate-fade-in text-center shadow-lg">
              {error}
            </div>
          )}

          {success && (
            <div className="p-4 bg-success/10 border border-success/20 text-success rounded-xl text-sm animate-fade-in text-center shadow-lg">
              {success}
            </div>
          )}

          <div className="flex justify-end pt-2 pb-12">
            <button
              type="submit"
              disabled={saving}
              className="gradient-accent text-white px-10 py-3.5 rounded-full text-sm font-semibold shadow-lg shadow-accent/20 hover:shadow-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-0.5 active:translate-y-0"
            >
              {saving ? tCommon('saving') : tCommon('save')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
