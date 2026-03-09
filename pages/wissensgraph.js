import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';

export default function WissensgraphPage() {
  return (
    <>
      <Head>
        <title>Wissensgraph - GhostTyper</title>
      </Head>
      <KnowledgePrepWorkspace
        fixedMode="knowledge_graph"
        heading="Wissensgraph"
        showModeSelector={false}
      />
    </>
  );
}
