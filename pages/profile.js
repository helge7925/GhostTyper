import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import LoadingSpinner from '../components/LoadingSpinner';
import { useTranslations } from '../lib/i18n';
import { Camera } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field, FieldInput } from '../components/ui/field';

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
          <Card className="p-8 flex flex-col items-center text-center">
            <input 
              id="profile-avatar"
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              accept="image/*" 
              className="hidden" 
            />
            
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative rounded-full group"
              aria-label="Profilbild auswählen"
            >
              {formData.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img 
                  src={formData.avatarUrl} 
                  alt="Avatar" 
                  className="w-32 h-32 rounded-full object-cover border-4 border-accent/20 group-hover:border-accent/50 transition-colors"
                />
              ) : (
                <div className="w-32 h-32 rounded-full gradient-accent flex items-center justify-center text-4xl font-bold text-white uppercase">
                  {formData.email.substring(0, 2)}
                </div>
              )}
              
              <div className="absolute inset-0 bg-overlay rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera className="w-8 h-8 text-white" aria-hidden="true" />
              </div>
            </button>
            
            <h2 className="mt-4 text-sm font-semibold text-primary">Profilbild ändern</h2>
            <p className="text-xs text-secondary mt-1">Bild auswählen, maximal 2 MB.</p>
          </Card>

          {/* Account Info */}
          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Account-Informationen</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t('name')} htmlFor="profile-name">
                <FieldInput
                  id="profile-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </Field>

              <Field label={t('email')} htmlFor="profile-email" required>
                <FieldInput
                  id="profile-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </Field>
            </div>
          </Card>

          {/* Password Section */}
          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Passwort ändern</h2>
            
            <Field label={t('currentPassword')} htmlFor="profile-current-password">
              <FieldInput
                id="profile-current-password"
                type="password"
                value={formData.currentPassword}
                onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                placeholder="Zur Bestätigung erforderlich"
              />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-subtle pt-4">
              <Field label={t('newPassword')} htmlFor="profile-new-password">
                <FieldInput
                  id="profile-new-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Min. 8 Zeichen"
                />
              </Field>
              <Field label={t('confirmPassword')} htmlFor="profile-confirm-password">
                <FieldInput
                  id="profile-confirm-password"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Passwort wiederholen"
                />
              </Field>
            </div>
          </Card>

          {error && (
            <div role="alert" className="p-4 border border-danger/30 text-danger rounded-xl text-sm animate-fade-in text-center">
              {error}
            </div>
          )}

          {success && (
            <div role="status" className="p-4 border border-success/30 text-success rounded-xl text-sm animate-fade-in text-center">
              {success}
            </div>
          )}

          <div className="flex justify-end pt-2 pb-12">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={saving}
            >
              {saving ? tCommon('saving') : tCommon('save')}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
