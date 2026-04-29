import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';

export default function DatentabellePage() {
  return (
    <>
      <Head>
        <title>Freie Datentabelle - GhostTyper</title>
      </Head>
      <KnowledgePrepWorkspace
        fixedMode="data_table"
        heading="Freie Datentabelle"
        showModeSelector={false}
      />
    </>
  );
}
