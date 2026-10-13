/**
 * search-probe — dispara frases contra la API real y muestra cuántos y cuáles
 * resultados devuelve cada modo de búsqueda (lexical / semantic / hybrid).
 *
 * NO usa la BD mock: apunta a la API en vivo (stack Docker), así que pega
 * contra los ~53k registros reales + el índice semántico ya precargado.
 *
 * Uso:
 *   cd apps/api
 *   npx ts-node --transpile-only src/scripts/search-probe.ts
 *   # o desde la raíz, con el stack arriba:
 *   pnpm --filter api exec ts-node --transpile-only src/scripts/search-probe.ts
 *
 * Variables opcionales:
 *   API_BASE     (default http://localhost:3001)
 *   PROBE_MODES  (default "lexical,hybrid,semantic")
 *   PROBE_LIMIT  (default 5)  -> cuántos items mostrar por modo
 *
 * Editar el array PHRASES de abajo para probar otras frases.
 */

import { meaningfulTerms } from '../stopwords';

const PHRASES: string[] = [
  // 1) Corta y genérica: 2 términos significativos → cobertura mínima = 1.
  'sala de control',
  // 2) Larga descriptiva (la del doc): 4 significativos → exige ~75% (3).
  'persona parada frente a una sala de control',
  // 3) Técnica y específica: varias palabras con sentido.
  'técnicos revisando alertas en paneles de calidad',
  // 4) Conceptual: suele traer ruido (mapa / mind map / diagrama).
  'mapa mental de procesos organizacionales',
  // 5) Otro dominio (retratos): mide si se cuela gente que no corresponde.
  'retrato corporativo de una mujer sonriendo',
];

const BASE = (process.env.API_BASE || 'http://localhost:3001').replace(/\/+$/, '');
const MODES = (process.env.PROBE_MODES || 'lexical,hybrid,semantic')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const LIMIT = Math.max(1, Number(process.env.PROBE_LIMIT || 5));

interface ImageItem {
  id: string;
  s3_key: string;
  subject?: string;
  filename?: string;
  tags?: string[];
  original_prompt?: string;
  created_at?: string;
}

interface SearchResponse {
  items: ImageItem[];
  total: number;
  mode: string;
  error?: string;
}

async function search(q: string, mode: string): Promise<SearchResponse> {
  const url = `${BASE}/api/search?q=${encodeURIComponent(q)}&mode=${mode}&limit=${LIMIT}&page=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
  }
  return (await res.json()) as SearchResponse;
}

/** Cobertura mínima que aplicará el servidor (misma fórmula que graph.ts). */
function minCoverage(nTerms: number): number {
  return nTerms <= 2 ? 1 : Math.floor(nTerms * 0.75);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function describeItem(item: ImageItem): string {
  const label = item.subject || item.filename || item.original_prompt || '(sin subject)';
  const tags = (item.tags || []).slice(0, 3).join(', ');
  return tags ? `${label}  · tags: ${tags}` : label;
}

function fmtTotal(n: number): string {
  return n.toLocaleString('es-AR');
}

async function main() {
  console.log(`Probe de búsqueda → ${BASE}`);
  console.log(`Modos: ${MODES.join(', ')}   ·   items por modo: ${LIMIT}   ·   frases: ${PHRASES.length}\n`);

  // Chequeo rápido de conexión.
  try {
    const health = await fetch(`${BASE}/api/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const h = (await health.json()) as any;
    const rows = h?.graph?.rows ?? '?';
    const mode = h?.search?.mode ?? '?';
    console.log(`API OK — filas en el grafo: ${rows} · modo por defecto: ${mode}\n`);
  } catch (err) {
    console.error(`No pude conectar con la API en ${BASE}.`);
    console.error(`  ${(err as Error).message}`);
    console.error('¿Está levantado el stack?  sudo docker compose up -d');
    process.exit(1);
  }

  // Resumen acumulado: fila por frase, columna por modo.
  const summary: { phrase: string; totals: Record<string, number | string> }[] = [];

  for (let i = 0; i < PHRASES.length; i++) {
    const phrase = PHRASES[i];
    const terms = meaningfulTerms(phrase);
    const minCov = minCoverage(terms.length);

    console.log(`[${i + 1}/${PHRASES.length}] "${phrase}"`);
    console.log(`      términos significativos: ${terms.length} → [${terms.join(', ')}] · cobertura mínima: ${minCov}`);

    const totals: Record<string, number | string> = {};
    for (const mode of MODES) {
      try {
        const data = await search(phrase, mode);
        totals[mode] = data.total;
        console.log(`      ${mode.padEnd(8)} total=${fmtTotal(data.total)}  (mostrando ${data.items.length})`);
        data.items.forEach((item, idx) => {
          console.log(`         ${String(idx + 1).padStart(2)}. [${shortId(item.id)}] ${describeItem(item)}`);
        });
      } catch (err) {
        totals[mode] = 'error';
        console.log(`      ${mode.padEnd(8)} ERROR: ${(err as Error).message}`);
      }
    }
    console.log('');
    summary.push({ phrase, totals });
  }

  // Tabla resumen (cuántos por frase × modo).
  const phraseW = Math.max(...PHRASES.map((p) => p.length), 6);
  const colW = 12;
  const header = 'frase'.padEnd(phraseW) + ' | ' + MODES.map((m) => m.padStart(colW)).join(' | ');
  console.log('Resumen (total de resultados)');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of summary) {
    const cells = MODES.map((m) => {
      const v = row.totals[m];
      return (typeof v === 'number' ? fmtTotal(v) : String(v ?? '-')).padStart(colW);
    });
    console.log(`"${row.phrase}"`.padEnd(phraseW + 2) + '|' + ' ' + cells.join(' | '));
  }
}

main().catch((err) => {
  console.error('[search-probe] Error:', err);
  process.exit(1);
});
