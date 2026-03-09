import Head from 'next/head';
import KnowledgePrepWorkspace from '../components/KnowledgePrepWorkspace';

export default function MindmapPage() {
  return (
    <>
      <Head>
        <title>Mindmap - GhostTyper</title>
      </Head>
      <KnowledgePrepWorkspace
        fixedMode="mindmap"
        heading="Mindmap"
        showModeSelector={false}
      />
    </>
  );
}
