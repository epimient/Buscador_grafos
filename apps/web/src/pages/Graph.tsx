import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Graph from 'graphology';
import Sigma from 'sigma';
import { fetchGraph, type GraphExport } from '@/services/api';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { LayoutGrid, Layers, Tag, Palette, Sun, Monitor, Image as ImageIcon } from 'lucide-react';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  image: <ImageIcon className="h-3 w-3" />,
  tag: <Tag className="h-3 w-3" />,
  style: <LayoutGrid className="h-3 w-3" />,
  mood: <Sun className="h-3 w-3" />,
  useCase: <Monitor className="h-3 w-3" />,
  color: <Palette className="h-3 w-3" />,
};

const TYPE_LABELS: Record<string, string> = {
  image: 'Imágenes',
  tag: 'Tags',
  style: 'Estilos',
  mood: 'Moods',
  useCase: 'Usos',
  color: 'Colores',
};

export function GraphPage() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(['image', 'tag', 'style', 'mood', 'useCase']),
  );
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const loadData = useCallback(async (types: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGraph({ types, limit: 200 });
      renderGraph(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function renderGraph(data: GraphExport) {
    if (!containerRef.current) return;

    // Cleanup previous instance.
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    graphRef.current = null;

    if (data.nodes.length === 0) {
      setNodeCount(0);
      setEdgeCount(0);
      return;
    }

    const graph = new Graph();
    graphRef.current = graph;

    // Add nodes.
    for (const node of data.nodes) {
      // Do NOT pass `type` to sigma — our custom types (tag, style, mood…)
      // are unknown to sigma and cause nodes to render as invisible.
      // Color is the visual differentiator.
      graph.addNode(node.id, {
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: node.size,
        color: node.color,
        label: node.label,
      });
    }

    // Add edges.
    for (const edge of data.edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        graph.addEdge(edge.source, edge.target, {
          size: Math.max(1, edge.weight * 0.5),
          color: '#374151',
          type: 'arrow',
        });
      }
    }

    setNodeCount(graph.order);
    setEdgeCount(graph.size);

    // Simple force layout.
    const settings = graph.nodes().map((n) => {
      const attrs = graph.getNodeAttributes(n);
      return { id: n, x: attrs.x, y: attrs.y };
    });

    // Apply a simple force-directed layout in-place.
    for (let iter = 0; iter < 50; iter++) {
      for (const node of graph.nodes()) {
        const attrs = graph.getNodeAttributes(node);
        let fx = 0, fy = 0;

        // Repulsion from other nodes.
        for (const other of graph.nodes()) {
          if (other === node) continue;
          const oAttrs = graph.getNodeAttributes(other);
          const dx = attrs.x - oAttrs.x;
          const dy = attrs.y - oAttrs.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 50 / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // Attraction along edges.
        for (const neighbor of graph.neighbors(node)) {
          const nAttrs = graph.getNodeAttributes(neighbor);
          const dx = nAttrs.x - attrs.x;
          const dy = nAttrs.y - attrs.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = dist * 0.01;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // Center gravity.
        fx -= attrs.x * 0.001;
        fy -= attrs.y * 0.001;

        graph.setNodeAttribute(node, 'x', attrs.x + fx * 0.1);
        graph.setNodeAttribute(node, 'y', attrs.y + fy * 0.1);
      }
    }

    sigmaRef.current = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      renderEdgeLabels: false,
      labelFont: 'Inter, sans-serif',
      labelSize: 11,
      labelColor: { color: '#e2e8f0' },
      edgeReducer: (edge, data) => {
        const res = { ...data };
        res.color = '#374151';
        res.size = Math.max(1, (data.weight ?? 1) * 0.5);
        return res;
      },
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (selectedNode && graph.areNeighbors(node, selectedNode)) {
          res.color = '#fbbf24';
          res.size = (data.size ?? 5) * 1.3;
        } else if (selectedNode && node === selectedNode) {
          res.color = '#ffffff';
          res.size = (data.size ?? 5) * 1.5;
        }
        return res;
      },
    });

    // Click handler.
    sigmaRef.current.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      if (attrs.type === 'image') {
        navigate(`/image/${encodeURIComponent(node)}`);
      } else if (attrs.type === 'tag') {
        navigate(`/tag/${encodeURIComponent(attrs.label)}`);
      } else {
        // Center on node.
        setSelectedNode(node);
        sigmaRef.current?.refresh();
      }
    });

    sigmaRef.current.on('clickStage', () => {
      setSelectedNode(null);
      sigmaRef.current?.refresh();
    });
  }

  useEffect(() => {
    loadData([...activeTypes]);
    return () => {
      sigmaRef.current?.kill();
    };
  }, []);

  function toggleType(type: string) {
    const next = new Set(activeTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setActiveTypes(next);
    loadData([...next]);
  }

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-ink-faint">Explorar</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-ink">Red de Grafo</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Explorá las conexiones entre imágenes, tags, estilos y moods.
          Click en un nodo para navegar.
        </p>
      </header>

      {/* Type toggles */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => toggleType(type)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTypes.has(type)
                ? 'bg-white/10 text-ink'
                : 'bg-white/[0.03] text-ink-faint hover:bg-white/5'
            }`}
          >
            {TYPE_ICONS[type]}
            {label}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="mb-4 flex items-center gap-4 text-xs text-ink-faint">
        <span>{nodeCount} nodos</span>
        <span>{edgeCount} aristas</span>
        {selectedNode && (
          <span className="text-amber-400">
            Seleccionado: {graphRef.current?.getNodeAttributes(selectedNode)?.label ?? selectedNode}
          </span>
        )}
      </div>

      {/* Graph container */}
      <div className="relative rounded-2xl border border-white/5 bg-canvas-raised overflow-hidden" style={{ height: '70vh' }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80">
            <Spinner />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <ErrorState message={error} onRetry={() => loadData([...activeTypes])} />
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
