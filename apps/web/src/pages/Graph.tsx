import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGraph, type GraphExport, type GraphNode } from '@/services/api';
import { GraphCanvas } from '@/components/features/GraphCanvas';
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(['image', 'tag', 'style', 'mood', 'useCase']),
  );
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [graphData, setGraphData] = useState<GraphExport | null>(null);

  const loadData = useCallback(async (types: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGraph({ types, limit: 200 });
      setGraphData(data);
      setNodeCount(data.nodes.length);
      setEdgeCount(data.edges.length);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function onNodeClick(node: GraphNode) {
    if (node.type === 'image') {
      navigate(`/image/${encodeURIComponent(node.id)}`);
    } else if (node.type === 'tag') {
      navigate(`/tag/${encodeURIComponent(node.label)}`);
    } else {
      // Centrar en metadatos (GraphCanvas resalta vecinos).
      setSelectedNode(node.id);
    }
  }

  useEffect(() => {
    loadData([...activeTypes]);
    return () => {};
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
            Seleccionado: {graphData?.nodes.find((n) => n.id === selectedNode)?.label ?? selectedNode}
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
        <div ref={containerRef} className="h-full w-full">
          {graphData && graphData.nodes.length > 0 && (
            <GraphCanvas data={graphData} onNodeClick={onNodeClick} />
          )}
        </div>
      </div>
    </div>
  );
}
