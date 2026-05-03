import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';
import { useTranslations } from '../lib/i18n';

export default function DatentabellePage() {
  const t = useTranslations('tablesPage');
  return (
    <>
      <Head>
        <title>{`${t('freeTable')} – GhostTyper`}</title>
      </Head>
      <KnowledgePrepWorkspace
        fixedMode="data_table"
        heading={t('freeTable')}
        showModeSelector={false}
      />
    </>
  );
}
