import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { exportVisNetworkPng } from '../lib/vis-export';

const TYPE_STYLES = {
  zentralthema: { background: '#0f172a', border: '#38bdf8' },
  central_topic: { background: '#0f172a', border: '#38bdf8' },
  hauptast: { background: '#0f766e', border: '#2dd4bf' },
  main_branch: { background: '#0f766e', border: '#2dd4bf' },
  unterast: { background: '#7c2d12', border: '#fb923c' },
  sub_branch: { background: '#7c2d12', border: '#fb923c' },
  detail: { background: '#581c87', border: '#c084fc' },
  default: { background: '#1f2937', border: '#64748b' },
};

const LABEL_WRAP = {
  detailed: {
    maxLineLength: 22,
    hardBreakLength: 18,
    maxWidth: 260,
  },
  compact: {
    maxLineLength: 16,
    hardBreakLength: 14,
    maxWidth: 210,
  },
};

function normalizeNodes(data) {
  const raw = Array.isArray(data?.knoten)
    ? data.knoten
    : Array.isArray(data?.nodes)
      ? data.nodes
      : [];

  return raw
    .map((node) => {
      const id = String(node?.id || '').trim();
      if (!id) return null;
      return {
        id,
        label: String(node?.label || node?.name || id).slice(0, 48),
        type: String(node?.typ || node?.type || 'default').toLowerCase(),
        description: String(node?.beschreibung || node?.description || '').trim(),
      };
    })
    .filter(Boolean);
}

function normalizeEdges(data, nodeSet) {
  const raw = Array.isArray(data?.kanten)
    ? data.kanten
    : Array.isArray(data?.edges)
      ? data.edges
      : [];

  const dedupe = new Set();
  const edges = [];
  for (const edge of raw) {
    const from = String(edge?.von || edge?.from || '').trim();
    const to = String(edge?.zu || edge?.to || '').trim();
    if (!from || !to || from === to) continue;
    if (!nodeSet.has(from) || !nodeSet.has(to)) continue;
    const relation = String(edge?.relation || edge?.type || '').trim();
    const key = `${from}|${relation}|${to}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    edges.push({
      from,
      to,
      relation,
      weight: Number(edge?.gewicht || edge?.weight || 1),
    });
  }
  return edges;
}

function resolveCenterNodeId(data, nodes, edges) {
  if (nodes.length === 0) return '';
  const declared = String(data?.zentralthema || data?.central_topic || '').trim();
  if (declared && nodes.some((node) => node.id === declared)) return declared;

  const scores = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    scores.set(edge.from, (scores.get(edge.from) || 0) + 1);
    scores.set(edge.to, (scores.get(edge.to) || 0) + 1);
  }
  const maxNode = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return maxNode?.[0] || nodes[0].id;
}

function assignLevels(centerId, edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }

  const levels = new Map([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length > 0) {
    const current = queue.shift();
    const nextLevel = (levels.get(current) || 0) + 1;
    const neighbors = adjacency.get(current) || [];
    for (const neighbor of neighbors) {
      if (levels.has(neighbor)) continue;
      levels.set(neighbor, nextLevel);
      queue.push(neighbor);
    }
  }
  return levels;
}

function splitLongWord(word, segmentLength) {
  if (!word || word.length <= segmentLength) return [word];
  const chunks = [];
  for (let index = 0; index < word.length; index += segmentLength) {
    chunks.push(word.slice(index, index + segmentLength));
  }
  return chunks;
}

function wrapNodeLabel(label, config) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (!text) return { label: '', longestLine: 0, lineCount: 1 };

  const tokens = text
    .split(' ')
    .filter(Boolean)
    .flatMap((word) => splitLongWord(word, config.hardBreakLength));

  const lines = [];
  let current = '';

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (candidate.length <= config.maxLineLength) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = token;
  }

  if (current) lines.push(current);

  return {
    label: lines.join('\n'),
    longestLine: lines.reduce((maxLen, line) => Math.max(maxLen, line.length), 0),
    lineCount: lines.length || 1,
  };
}

export default function MindmapRenderer({ data, title }) {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const exportConfigRef = useRef({ nodes: [], edges: [], options: null });
  const [fullscreen, setFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [orientation, setOrientation] = useState('horizontal');

  const prepared = useMemo(() => {
    const nodes = normalizeNodes(data);
    const nodeSet = new Set(nodes.map((node) => node.id));
    const edges = normalizeEdges(data, nodeSet);
    const centerId = resolveCenterNodeId(data, nodes, edges);
    return { nodes, edges, centerId };
  }, [data]);

  const handleExportPNG = useCallback(async () => {
    const snapshot = exportConfigRef.current;
    if (!snapshot?.options || !snapshot.nodes?.length) return;

    try {
      await exportVisNetworkPng({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        options: snapshot.options,
        filename: `${title?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'mindmap'}.png`,
        sourceContainer: containerRef.current,
        backgroundColor: '#0a0f18',
      });
    } catch (error) {
      console.error('Mindmap export failed:', error);
    }
  }, [title]);

  useEffect(() => {
    if (!containerRef.current) return;
    const { nodes, edges, centerId } = prepared;
    if (nodes.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const levels = assignLevels(centerId, edges);
    const compact = false;
    const isHorizontal = orientation === 'horizontal';
    const wrapConfig = compact ? LABEL_WRAP.compact : LABEL_WRAP.detailed;

    const wrappedLabelMeta = new Map();
    let maxLineCount = 1;
    let maxLineLength = 1;

    for (const node of nodes) {
      const wrapped = wrapNodeLabel(node.label, wrapConfig);
      wrappedLabelMeta.set(node.id, wrapped);
      maxLineCount = Math.max(maxLineCount, wrapped.lineCount);
      maxLineLength = Math.max(maxLineLength, wrapped.longestLine);
    }

    const baseNodeSpacing = compact ? 135 : 175;
    const baseTreeSpacing = compact ? 180 : 240;
    const baseLevelSeparation = compact ? 145 : 175;
    const labelHeightBoost = Math.max(0, maxLineCount - 1) * (compact ? 22 : 28);
    const labelWidthBoost = Math.max(0, maxLineLength - 14) * (compact ? 2 : 3);

    const nodeSpacing = Math.min(360, baseNodeSpacing + labelHeightBoost + labelWidthBoost);
    const treeSpacing = Math.min(440, baseTreeSpacing + labelHeightBoost + labelWidthBoost);
    const levelSeparation = Math.min(360, baseLevelSeparation + labelHeightBoost);

    const visNodes = new DataSet(
      nodes.map((node) => {
        const style = TYPE_STYLES[node.type] || TYPE_STYLES.default;
        const isCenter = node.id === centerId;
        const wrapped = wrappedLabelMeta.get(node.id);
        return {
          id: node.id,
          label: wrapped?.label || node.label,
          title: node.description || node.label,
          level: levels.get(node.id) ?? 1,
          shape: 'box',
          widthConstraint: { maximum: wrapConfig.maxWidth },
          margin: compact
            ? { top: 8, right: 10, bottom: 8, left: 10 }
            : { top: 10, right: 12, bottom: 10, left: 12 },
          font: {
            color: '#f8fafc',
            size: isCenter ? 14 : compact ? 11 : 12,
            face: 'Inter, sans-serif',
            multi: true,
          },
          color: {
            background: isCenter ? '#1e293b' : style.background,
            border: isCenter ? '#22d3ee' : style.border,
            highlight: {
              background: '#0f172a',
              border: '#67e8f9',
            },
          },
          borderWidth: isCenter ? 2.5 : 1.5,
        };
      })
    );

    const visEdges = new DataSet(
      edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        label: compact ? '' : edge.relation,
        arrows: { to: { enabled: true, scaleFactor: 0.55 } },
        width: Math.max(1, Math.min(3, Number(edge.weight || 1))),
        color: { color: '#475569', highlight: '#22d3ee' },
        smooth: {
          enabled: true,
          type: 'cubicBezier',
          roundness: compact ? 0.24 : 0.34,
          forceDirection: isHorizontal ? 'horizontal' : 'vertical',
        },
        font: {
          size: 10,
          color: '#dbeafe',
          background: 'rgba(2, 6, 23, 0.82)',
          strokeWidth: 0,
          align: 'middle',
        },
      }))
    );

    const options = {
      layout: {
        hierarchical: {
          enabled: true,
          direction: isHorizontal ? 'LR' : 'UD',
          sortMethod: 'directed',
          levelSeparation,
          nodeSpacing,
          treeSpacing,
        },
      },
      interaction: {
        hover: true,
        dragView: true,
        zoomView: true,
      },
      physics: false,
      edges: {
        smooth: true,
      },
    };

    exportConfigRef.current = {
      nodes: visNodes.get(),
      edges: visEdges.get(),
      options,
    };

    networkRef.current = new Network(
      containerRef.current,
      { nodes: visNodes, edges: visEdges },
      options
    );

    networkRef.current.once('afterDrawing', () => {
      setLoading(false);
      networkRef.current?.fit({
        animation: {
          duration: 280,
          easingFunction: 'easeInOutQuad',
        },
      });
    });

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [prepared, orientation]);

  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-[100] bg-dark-bg p-6 flex flex-col'
    : 'relative w-full h-[600px] border border-white/[0.06] rounded-2xl bg-[#0a0f18] overflow-hidden shadow-inner';

  return (
    <div className={wrapperClass}>
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button
          onClick={() => setOrientation((prev) => (prev === 'horizontal' ? 'vertical' : 'horizontal'))}
          className="bg-dark-card hover:bg-white/10 text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.1] transition-colors shadow-lg"
          title="Ausrichtung wechseln"
        >
          {orientation === 'horizontal' ? 'Horizontal' : 'Vertikal'}
        </button>
        <button
          onClick={handleExportPNG}
          className="bg-dark-card hover:bg-white/10 text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.1] transition-colors shadow-lg"
        >
          Export
        </button>
        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="bg-dark-card hover:bg-white/10 text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.1] transition-colors shadow-lg"
        >
          {fullscreen ? 'Schließen' : 'Vollbild'}
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-[#0a0f18]/80 backdrop-blur-sm transition-all duration-300">
          <div className="w-8 h-8 rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan animate-spin mb-3" />
          <p className="text-xs text-text-secondary tracking-widest uppercase font-bold">Mindmap layout...</p>
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" style={{ outline: 'none' }} />
    </div>
  );
}
