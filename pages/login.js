import Head from 'next/head';
import { useRouter } from 'next/router';
import { getProviders, signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useTranslations } from '../lib/i18n';
import { Button } from '../components/ui/button';
import { Field, FieldInput } from '../components/ui/field';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState(null);
  const t = useTranslations('auth');

  useEffect(() => {
    getProviders().then((items) => setProviders(items || {})).catch(() => setProviders({}));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError(t('wrongCredentials'));
    } else {
      router.push('/');
    }
  }

  return (
    <>
      <Head>
        <title>{`${t('loginTitle')} – GhostTyper`}</title>
      </Head>

      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="sr-only">{t('loginTitle')}</h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-text.png"
              alt="GhostTyper"
              width={180}
              height={48}
              className="h-12 w-auto mx-auto mb-2"
            />
            <p className="text-sm text-secondary">{t('tagline')}</p>
          </div>
          <div className="bg-surface border border-subtle rounded-xl p-8">
            {providers?.oidc && (
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => signIn('oidc', { callbackUrl: '/' })}
                className="w-full mb-5"
              >
                {t('ssoButton')}
              </Button>
            )}

            {providers?.credentials && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <Field label={t('email')} htmlFor="email">
                <FieldInput
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder={t('emailPlaceholder')}
                />
              </Field>

              <Field label={t('password')} htmlFor="password">
                <FieldInput
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>

              {error && (
                <p className="text-sm text-danger">{error}</p>
              )}

              <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
                {loading ? t('submitLoading') : t('submit')}
              </Button>
            </form>
            )}

            {providers && !providers.credentials && !providers.oidc && (
              <p className="text-sm text-secondary text-center">{t('noProvider')}</p>
            )}

            <p className="text-sm text-secondary text-center mt-6">{t('noAccount')}</p>
          </div>
        </div>
      </div>
    </>
  );
}
