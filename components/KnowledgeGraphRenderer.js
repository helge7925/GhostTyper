import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { exportVisNetworkPng } from '../lib/vis-export';

function buildCurvedEdges(rawEdges = [], { showEdgeLabels = true } = {}) {
    const buckets = new Map();
    const parsed = rawEdges
        .map((edge) => {
            const from = edge.von || edge.from;
            const to = edge.zu || edge.to;
            if (!from || !to) return null;
            const canonical = [String(from), String(to)].sort().join('::');
            return { edge, from, to, canonical };
        })
        .filter(Boolean);

    for (const item of parsed) {
        if (!buckets.has(item.canonical)) buckets.set(item.canonical, []);
        buckets.get(item.canonical).push(item);
    }

    function offsetFor(index) {
        if (index === 0) return 0;
        const step = Math.ceil(index / 2);
        return index % 2 === 1 ? step : -step;
    }

    const visEdges = [];
    for (const group of buckets.values()) {
        const sortedGroup = [...group].sort((a, b) => {
            const aKey = `${a.from}->${a.to}`;
            const bKey = `${b.from}->${b.to}`;
            return aKey.localeCompare(bKey);
        });

        sortedGroup.forEach((item, index) => {
            const offset = offsetFor(index);
            const roundness = 0.16 + (Math.abs(offset) * 0.08);
            const relationText = String(item.edge.relation || '').trim();
            visEdges.push({
                from: item.from,
                to: item.to,
                label: showEdgeLabels ? relationText : '',
                title: relationText || undefined,
                arrows: {
                    to: {
                        enabled: true,
                        scaleFactor: 0.7,
                    },
                },
                font: {
                    align: 'top',
                    color: '#dbe7ff',
                    size: 10,
                    background: 'rgba(12, 18, 32, 0.82)',
                    strokeWidth: 0,
                    vadjust: -2,
                },
                color: { color: '#5b6c8d', highlight: '#22d3ee' },
                width: 1.1,
                smooth: {
                    enabled: true,
                    type: offset >= 0 ? 'curvedCW' : 'curvedCCW',
                    roundness,
                },
            });
        });
    }

    return visEdges;
}

export default function KnowledgeGraphRenderer({ data, title }) {
    const containerRef = useRef(null);
    const networkRef = useRef(null);
    const exportConfigRef = useRef({ nodes: [], edges: [], options: null });
    const [fullscreen, setFullscreen] = useState(false);
    const [loading, setLoading] = useState(true);

    // Use useCallback to keep the reference stable
    const handleExportPNG = useCallback(async () => {
        const snapshot = exportConfigRef.current;
        if (!snapshot?.options || !snapshot.nodes?.length) return;

        try {
            await exportVisNetworkPng({
                nodes: snapshot.nodes,
                edges: snapshot.edges,
                options: snapshot.options,
                filename: `${title?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'knowledge_graph'}.png`,
                sourceContainer: containerRef.current,
                backgroundColor: '#111111',
            });
        } catch (error) {
            console.error('Knowledge graph export failed:', error);
        }
    }, [title]);

    useEffect(() => {
        if (!containerRef.current || !data) return;

        // Safety check: ensure nodes and edges exist
        const nodes = data.knoten || data.nodes || [];
        const edges = data.kanten || data.edges || [];
        const compactMode = false;

        if (nodes.length === 0 && edges.length === 0) {
            setLoading(false);
            return;
        }

        setLoading(true);

        // Map JSON data to vis-network format
        const visNodes = new DataSet(
            nodes.map(node => ({
                id: node.id,
                label: node.label || node.id,
                title: node.beschreibung || node.description || `Typ: ${node.typ || node.type}`,
                group: node.typ || node.type || 'default',
                shape: 'dot',
                size: compactMode ? 14 : 15,
                font: { color: '#ffffff', size: compactMode ? 11 : 12, face: 'Inter, sans-serif' }
            }))
        );

        const visEdges = new DataSet(buildCurvedEdges(edges, { showEdgeLabels: !compactMode }));

        // Network options matched to GhostTyper dark theme + Steamlit defaults
        const options = {
            nodes: {
                borderWidth: 2,
                borderWidthSelected: 3,
                color: {
                    border: '#334155',
                    background: '#0f172a',
                    highlight: { border: '#22d3ee', background: '#172554' }
                }
            },
            edges: {
                width: compactMode ? 0.9 : 1,
                hoverWidth: compactMode ? 1.6 : 2,
                selectionWidth: compactMode ? 2.4 : 3
            },
            physics: {
                forceAtlas2Based: {
                    gravitationalConstant: compactMode ? -170 : -130,
                    centralGravity: compactMode ? 0.003 : 0.005,
                    springLength: compactMode ? 320 : 260,
                    springConstant: compactMode ? 0.05 : 0.06
                },
                minVelocity: compactMode ? 0.4 : 0.45,
                solver: 'forceAtlas2Based',
                stabilization: {
                    enabled: true,
                    iterations: compactMode ? 1000 : 1200,
                    updateInterval: 100,
                    onlyDynamicEdges: false,
                    fit: true
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                zoomView: true,
                dragView: true,
                hideEdgesOnDrag: compactMode
            },
            groups: {
                default: { color: { background: '#1f2937', border: '#475569' } },
                person: { color: { background: '#0891b2', border: '#06b6d4' } },
                organisation: { color: { background: '#0f766e', border: '#14b8a6' } },
                organization: { color: { background: '#0f766e', border: '#14b8a6' } },
                projekt: { color: { background: '#3730a3', border: '#6366f1' } },
                project: { color: { background: '#3730a3', border: '#6366f1' } },
                thema: { color: { background: '#6d28d9', border: '#8b5cf6' } },
                topic: { color: { background: '#6d28d9', border: '#8b5cf6' } },
                aufgabe: { color: { background: '#b45309', border: '#f59e0b' } },
                task: { color: { background: '#b45309', border: '#f59e0b' } },
                entscheidung: { color: { background: '#be123c', border: '#f43f5e' } },
                decision: { color: { background: '#be123c', border: '#f43f5e' } },
                datum: { color: { background: '#15803d', border: '#22c55e' } },
                date: { color: { background: '#15803d', border: '#22c55e' } },
                ort: { color: { background: '#1d4ed8', border: '#3b82f6' } },
                location: { color: { background: '#1d4ed8', border: '#3b82f6' } },
                begriff: { color: { background: '#3f6212', border: '#84cc16' } },
                concept: { color: { background: '#3f6212', border: '#84cc16' } }
            }
        };

        exportConfigRef.current = {
            nodes: visNodes.get(),
            edges: visEdges.get(),
            options,
        };

        // Initialize Network
        networkRef.current = new Network(
            containerRef.current,
            { nodes: visNodes, edges: visEdges },
            options
        );

        // Listen to events
        networkRef.current.on('stabilizationIterationsDone', function () {
            setLoading(false);
            networkRef.current.fit();
        });

        return () => {
            if (networkRef.current) {
                networkRef.current.destroy();
                networkRef.current = null;
            }
        };
    }, [data]);

    const wrapperClass = fullscreen
        ? 'fixed inset-0 z-[100] bg-dark-bg p-6 flex flex-col'
        : 'relative w-full h-[600px] border border-white/[0.06] rounded-2xl bg-[#111111] overflow-hidden shadow-inner';

    return (
        <div className={wrapperClass}>
            <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button
                    onClick={handleExportPNG}
                    className="bg-dark-card hover:bg-white/10 text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.1] transition-colors shadow-lg flex items-center gap-1.5"
                    title="Als PNG exportieren"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Export
                </button>
                <button
                    onClick={() => setFullscreen(!fullscreen)}
                    className="bg-dark-card hover:bg-white/10 text-text-primary px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.1] transition-colors shadow-lg flex items-center gap-1.5"
                >
                    {fullscreen ? (
                        <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg> Schließen</>
                    ) : (
                        <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg> Vollbild</>
                    )}
                </button>
            </div>

            {loading && (
                <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-[#111111]/80 backdrop-blur-sm transition-all duration-300">
                    <div className="w-8 h-8 rounded-full border-2 border-accent-orange/20 border-t-accent-orange animate-spin mb-3"></div>
                    <p className="text-xs text-text-secondary tracking-widest uppercase font-bold">Layout berechnen...</p>
                </div>
            )}

            {/* Vis Network Container */}
            <div
                ref={containerRef}
                className="w-full h-full"
                style={{ outline: 'none' }}
            />
        </div>
    );
}
