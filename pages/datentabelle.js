import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';

export default function DatentabellePage() {
  return (
    <>
      <Head>
        <title>Datentabelle - GhostTyper</title>
      </Head>
      <KnowledgePrepWorkspace
        fixedMode="data_table"
        heading="Datentabelle"
        showModeSelector={false}
      />
    </>
  );
}
