import { Network } from 'vis-network';
import { DataSet } from 'vis-data';

function cloneOptions(options) {
  if (!options || typeof options !== 'object') return {};
  if (typeof structuredClone === 'function') {
    return structuredClone(options);
  }
  return JSON.parse(JSON.stringify(options));
}

function deriveExportSize(sourceContainer, scale, minEdge, maxEdge) {
  const rect = sourceContainer?.getBoundingClientRect?.() || {};
  const sourceWidth = Math.max(1, Math.round(rect.width || 1200));
  const sourceHeight = Math.max(1, Math.round(rect.height || 800));
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const targetLongEdge = Math.max(minEdge, Math.min(maxEdge, Math.round(sourceLongEdge * scale)));
  const factor = targetLongEdge / sourceLongEdge;

  const width = Math.max(1, Math.round(sourceWidth * factor));
  const height = Math.max(1, Math.round(sourceHeight * factor));

  return { width, height };
}

function triggerDownload(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportVisNetworkPng({
  nodes = [],
  edges = [],
  options = {},
  filename = 'network.png',
  sourceContainer = null,
  backgroundColor = '#0b1220',
  scale = 3,
  minEdge = 2200,
  maxEdge = 4096,
}) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error('Keine Knoten zum Export vorhanden.');
  }

  const { width, height } = deriveExportSize(sourceContainer, scale, minEdge, maxEdge);
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-20000px';
  host.style.top = '0';
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.overflow = 'hidden';
  host.style.background = backgroundColor;
  document.body.appendChild(host);

  let tempNetwork = null;

  try {
    const exportOptions = cloneOptions(options);
    exportOptions.interaction = {
      ...(exportOptions.interaction || {}),
      dragView: false,
      zoomView: false,
      hover: false,
    };

    tempNetwork = new Network(
      host,
      {
        nodes: new DataSet(nodes),
        edges: new DataSet(edges),
      },
      exportOptions
    );

    tempNetwork.fit({ animation: false });

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      tempNetwork.once('stabilizationIterationsDone', () => {
        tempNetwork.fit({ animation: false });
        setTimeout(finish, 180);
      });
      tempNetwork.once('afterDrawing', () => {
        setTimeout(finish, 120);
      });
      setTimeout(() => {
        tempNetwork.fit({ animation: false });
        finish();
      }, 2600);
    });

    const canvas = host.querySelector('canvas');
    if (!canvas) {
      throw new Error('Canvas für Export konnte nicht erstellt werden.');
    }

    triggerDownload(canvas.toDataURL('image/png'), filename);
  } finally {
    if (tempNetwork) {
      tempNetwork.destroy();
    }
    host.remove();
  }
}
