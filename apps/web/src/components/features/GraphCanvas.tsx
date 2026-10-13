import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataSet, Network } from 'vis-network/standalone';
import type { Options, DataSetNodes, DataSetEdges, Node, Edge, IdType } from 'vis-network/standalone';
import type { GraphExport, GraphNode } from '@/services/api';

interface GraphCanvasProps {
  data: GraphExport;
  /** Altura del contenedor. */
  height?: string;
  /** Callback sobre un click de nodo; por defecto navega a /image/<id> o /tag/<label>. */
  onNodeClick?: (node: GraphNode) => void;
}

const NODE_HIGHLIGHT = '#fbbf24'; // ámbar (vecinos del seleccionado)
const NODE_SELECTED = '#ffffff'; // blanco (nodo seleccionado)
const NODE_DIM = 'rgba(148,163,184,0.35)'; // resto atenuado

/**
 * Renderiza un grafo con vis-network — el mismo motor (vis.js) que usa el
 * viewer graph.html de Graphify. Física force-directed integrada (Barnes-Hut),
 * clicks con highlight de vecinos, zoom/pan. Reutilizable entre la página de
 * Grafo y el subgrafo de resultados de búsqueda.
 */
export function GraphCanvas({ data, height = '70vh', onNodeClick }: GraphCanvasProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSetNodes | null>(null);
  const edgesRef = useRef<DataSetEdges | null>(null);
  const originalColors = useRef<Map<string, string>>(new Map());
  // Mantener el último callback en un ref para que el efecto NO dependa de la
  // identidad de `onNodeClick`: si dependiera, cada re-render del padre (p. ej.
  // al seleccionar un nodo) reconstruiría la red y RE-DISPARARÍA la física — el
  // grafo se "vuelve a acomodar" en cada clic.
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cleanup del render anterior.
    if (networkRef.current) {
      networkRef.current.destroy();
      networkRef.current = null;
    }
    nodesRef.current = null;
    edgesRef.current = null;
    originalColors.current = new Map();

    if (data.nodes.length === 0) return;

    // Nodos → vis-node (id puede ser string; vis acepta cualquier IdType).
    const nodes: Node[] = data.nodes.map((node) => {
      originalColors.current.set(node.id, node.color);
      return {
        id: node.id,
        label: node.label,
        size: Math.max(5, Math.min(30, node.size * 1.6)),
        color: node.color,
        shape: 'dot',
      };
    });

    // Aristas → vis-edge. `size` del sigma era el ancho: lo pasamos a `width`.
    const edges: Edge[] = data.edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      width: Math.max(1, edge.weight * 0.5),
      color: '#374151',
    }));

    const nodesDataSet: DataSetNodes = new DataSet(nodes);
    const edgesDataSet: DataSetEdges = new DataSet(edges);
    nodesRef.current = nodesDataSet;
    edgesRef.current = edgesDataSet;

    const options: Options = {
      autoResize: true,
      nodes: {
        shape: 'dot',
        font: {
          color: '#e2e8f0',
          face: 'Inter, sans-serif',
          size: 12,
          strokeWidth: 0,
        },
        shadow: true,
      },
      edges: {
        color: '#374151',
        smooth: false,
      },
      interaction: {
        hover: true,
        hoverConnectedEdges: false,
        zoomView: true,
        dragView: true,
        selectable: true,
        multiselect: false,
      },
      physics: {
        enabled: true,
        // `fit:true` encuadra el grafo al terminar de estabilizar.
        stabilization: { enabled: true, iterations: 1000, fit: true },
        barnesHut: {
          // Repulsión moderada: -40000 (20× el default) no converge — el grafo
          // sigue empujándose y "gira" durante toda la estabilización. -12000
          // mantiene el look de red dispersa pero sí asienta.
          gravitationalConstant: -12000,
          springLength: 120,
          springConstant: 0.04,
          // `damping` frena la energía (default 0.09); `avoidOverlap` alto (0.6)
          // mantiene a los nodos rebotando. Con 0.4 + damping se apaga la vibración.
          damping: 0.2,
          avoidOverlap: 0.4,
        },
      },
    };

    const network = new Network(container, { nodes: nodesDataSet, edges: edgesDataSet }, options);
    networkRef.current = network;

    // Congelar la física cuando termina la estabilización inicial.
    //
    // OJO: `stopSimulation()` NO alcanza — solo pausa, y vis-network la reinicia
    // al "alterar el dataset" (nuestro highlight hace nodesDataSet.update() en
    // cada click) o al arrastrar un nodo. Desactivar `physics` la congela de
    // verdad, así que los updates de color no la vuelven a disparar.
    //
    // Se escuchan AMBOS eventos: 'stabilized' (el grafo convergió) y
    // 'stabilizationIterationsDone' (agotó las iteraciones sin converger, típico
    // en grafos grandes con repulsión fuerte). Si solo se escuchara el primero,
    // en esos casos la física quedaría corriendo y el grafo temblaría siempre.
    const freezePhysics = () => network.setOptions({ physics: { enabled: false } });
    network.once('stabilized', freezePhysics);
    network.once('stabilizationIterationsDone', freezePhysics);

    const highlight = (nodeId: string) => {
      const updates: Node[] = [];
      const rawConnected = network.getConnectedNodes(nodeId);
      const connected = new Set<string>(
        (Array.isArray(rawConnected) ? rawConnected : []).map(String),
      );

      for (const node of data.nodes) {
        let color: string;
        if (node.id === nodeId) {
          color = NODE_SELECTED;
        } else if (connected.has(node.id)) {
          color = NODE_HIGHLIGHT;
        } else {
          color = NODE_DIM;
        }
        updates.push({ id: node.id as IdType, color });
      }
      nodesDataSet.update(updates);
      network.selectNodes([nodeId], false);
    };

    const clearHighlight = () => {
      const updates: Node[] = [];
      for (const node of data.nodes) {
        updates.push({
          id: node.id as IdType,
          color: originalColors.current.get(node.id) ?? node.color,
        });
      }
      nodesDataSet.update(updates);
      network.unselectAll();
    };

    // Click en un nodo: highlight de vecinos + navegación/callback.
    network.on('click', (params?: { nodes?: IdType[] }) => {
      const [id] = params?.nodes ?? [];
      if (id === undefined || id === null) {
        clearHighlight();
        return;
      }

      const nodeId = String(id);
      const info = data.nodes.find((n) => n.id === nodeId);
      if (!info) return;

      highlight(nodeId);

      const onClick = onNodeClickRef.current;
      if (onClick) {
        onClick(info);
        return;
      }

      if (info.type === 'image') {
        navigate(`/image/${encodeURIComponent(nodeId)}`);
      } else if (info.type === 'tag') {
        navigate(`/tag/${encodeURIComponent(info.label)}`);
      }
    });

    // Deseleccionar al hacer click fuera de cualquier nodo.
    network.on('deselectNode', () => {
      clearHighlight();
    });

    return () => {
      network.destroy();
      networkRef.current = null;
      nodesRef.current = null;
      edgesRef.current = null;
    };
  }, [data, navigate]);

  return <div ref={containerRef} className="h-full w-full" style={{ height }} />;
}