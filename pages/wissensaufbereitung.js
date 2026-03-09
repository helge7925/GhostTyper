import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';

export default function WissensaufbereitungPage() {
  return (
    <>
      <Head>
        <title>Wissensaufbereitung - GhostTyper</title>
      </Head>
      <KnowledgePrepWorkspace heading="Wissensaufbereitung" />
    </>
  );
}
