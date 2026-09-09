/**
 * Motor generador de dataset sintético — VORAEL.
 *
 * Combina pools de subjects × styles × moods × use_cases para producir un
 * conjunto grande (p.ej. 1000) de filas `ImageRow` con metadata rica y variada,
 * pensadas para probar el buscador de tokens, la co-ocurrencia de tags y el grafo.
 *
 * Es puro y determinista: con la misma semilla produce exactamente el mismo
 * dataset (se usa un PRNG mulberry32), ideal para tests y re-runs idempotentes.
 */
import type { ImageRow } from '../types';

// ── RNG determinista (mulberry32) ───────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: () => number, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Pools de dominio ─────────────────────────────────────────────────────────

interface SubjectEntry {
  article: string;
  word: string;
  scene: string;
  title: string;
  tags: string[];
}

const SUBJECTS: SubjectEntry[] = [
  { article: 'a', word: 'cat', scene: 'perched on a mossy wooden windowsill', title: 'Cat on windowsill', tags: ['cat', 'animal', 'cozy', 'indoor', 'window'] },
  { article: 'a', word: 'cat', scene: 'curled up sleeping on old library books', title: 'Sleeping cat on books', tags: ['cat', 'animal', 'library', 'books', 'cozy', 'indoor'] },
  { article: 'a', word: 'dog', scene: 'running through tall golden grass', title: 'Dog running in grass', tags: ['dog', 'animal', 'outdoor', 'nature', 'playful'] },
  { article: 'a', word: 'golden retriever', scene: 'splashing through ocean waves at sunset', title: 'Golden retriever at beach', tags: ['dog', 'animal', 'beach', 'ocean', 'sunset'] },
  { article: 'a', word: 'fox', scene: 'peering out from between autumn ferns', title: 'Fox between ferns', tags: ['fox', 'animal', 'forest', 'autumn', 'outdoor'] },
  { article: 'an', word: 'owl', scene: 'perched on a weathered fence post at dusk', title: 'Owl on fence post', tags: ['owl', 'animal', 'bird', 'dusk', 'outdoor', 'mysterious'] },
  { article: 'a', word: 'wolf', scene: 'howling on a snow-covered ridge', title: 'Howling wolf on ridge', tags: ['wolf', 'animal', 'snow', 'mountain', 'wild', 'dramatic'] },
  { article: 'a', word: 'horse', scene: 'galloping across an open meadow', title: 'Horse in meadow', tags: ['horse', 'animal', 'meadow', 'outdoor', 'nature'] },
  { article: 'a', word: 'parrot', scene: 'resting on a carved wooden branch', title: 'Parrot on branch', tags: ['parrot', 'animal', 'bird', 'colorful', 'tropical'] },
  { article: 'an', word: 'elephant', scene: 'trudging through a dusty savanna at golden hour', title: 'Elephant at savanna', tags: ['elephant', 'animal', 'savanna', 'africa', 'golden hour'] },
  { article: 'a', word: 'bear cub', scene: 'climbing a fallen pine tree', title: 'Bear cub climbing pine', tags: ['bear', 'animal', 'forest', 'cute', 'nature'] },
  { article: 'a', word: 'hedgehog', scene: 'sniffing a fallen leaf in a garden', title: 'Hedgehog in garden', tags: ['hedgehog', 'animal', 'garden', 'small', 'cozy', 'nature'] },
  { article: 'a', word: 'rabbit', scene: 'sitting among dew-covered clover', title: 'Rabbit in clover', tags: ['rabbit', 'animal', 'garden', 'dew', 'spring', 'cute'] },
  { article: 'a', word: 'raccoon', scene: 'washing fruit by a woodland stream', title: 'Raccoon at stream', tags: ['raccoon', 'animal', 'forest', 'water', 'nocturnal'] },
  { article: 'a', word: 'mountain range', scene: 'bathed in soft morning alpenglow', title: 'Mountain range at dawn', tags: ['mountain', 'landscape', 'nature', 'dawn', 'alpine'] },
  { article: 'a', word: 'dense pine forest', scene: 'wrapped in drifting low clouds', title: 'Pine forest in clouds', tags: ['forest', 'trees', 'nature', 'mist', 'pines'] },
  { article: 'a', word: 'towering waterfall', scene: 'crashing into a turquoise pool', title: 'Waterfall in jungle', tags: ['waterfall', 'water', 'nature', 'jungle', 'turquoise'] },
  { article: 'a', word: 'desert dune field', scene: 'carved by rippling evening wind', title: 'Desert dunes', tags: ['desert', 'sand', 'landscape', 'nature', 'dunes'] },
  { article: 'a', word: 'vibrant coral reef', scene: 'teeming with tropical fish', title: 'Coral reef underwater', tags: ['coral', 'reef', 'ocean', 'underwater', 'colorful'] },
  { article: 'an', word: 'aurora sky', scene: 'undulating over a frozen lake', title: 'Aurora over lake', tags: ['aurora', 'northern lights', 'sky', 'frozen', 'night', 'lake'] },
  { article: 'an', word: 'autumn avenue', scene: 'lined with crimson maple trees', title: 'Autumn avenue', tags: ['autumn', 'trees', 'city', 'leaves', 'red'] },
  { article: 'a', word: 'cherry blossom grove', scene: 'shedding petals into a gentle breeze', title: 'Cherry blossom grove', tags: ['cherry blossom', 'spring', 'nature', 'pink', 'trees'] },
  { article: 'a', word: 'secluded tropical beach', scene: 'with palm trees leaning over turquoise shallows', title: 'Turquoise palm beach', tags: ['beach', 'tropical', 'palm', 'ocean', 'paradise'] },
  { article: 'a', word: 'misty bamboo grove', scene: 'where light filters through tall canes', title: 'Bamboo grove', tags: ['bamboo', 'forest', 'mist', 'nature', 'green'] },
  { article: 'a', word: 'glacier', scene: 'calving into an ice-blue fjord', title: 'Glacier fjord', tags: ['glacier', 'ice', 'fjord', 'cold', 'blue', 'nature'] },
  { article: 'a', word: 'wildflower meadow', scene: 'rolling toward a lavender horizon', title: 'Wildflower meadow', tags: ['flowers', 'meadow', 'nature', 'colorful', 'field'] },
  { article: 'a', word: 'neon-lit city street', scene: 'glistening after a summer rain', title: 'Neon city street', tags: ['city', 'neon', 'rain', 'night', 'urban', 'street'] },
  { article: 'a', word: 'gothic cathedral', scene: 'casting long shadows under a full moon', title: 'Gothic cathedral', tags: ['cathedral', 'gothic', 'architecture', 'moon', 'dark', 'city'] },
  { article: 'a', word: 'quiet Paris street', scene: 'with shuttered cafés at first light', title: 'Paris street', tags: ['paris', 'street', 'cafe', 'europe', 'city', 'morning'] },
  { article: 'a', word: 'narrow Japanese alley', scene: 'hung with paper lanterns', title: 'Japanese alley at night', tags: ['japan', 'alley', 'lanterns', 'night', 'city', 'architecture'] },
  { article: 'a', word: 'bustling street market', scene: 'crowded with colorful awnings', title: 'Street market', tags: ['market', 'colorful', 'crowds', 'urban', 'street'] },
  { article: 'an', word: 'Italian piazza', scene: 'warmed by late afternoon sunlight', title: 'Italian piazza', tags: ['italy', 'plaza', 'architecture', 'europe', 'sun'] },
  { article: 'a', word: 'towering futuristic skyline', scene: 'dotted with flying vehicles', title: 'Futuristic skyline', tags: ['skyline', 'future', 'city', 'scifi', 'towers'] },
  { article: 'a', word: 'rain-slicked Tokyo intersection', scene: 'blazing with neon advertisements', title: 'Tokyo rain intersection', tags: ['tokyo', 'neon', 'rain', 'city', 'night', 'japan'] },
  { article: 'a', word: 'lighthouse', scene: 'standing on a windswept cliff', title: 'Lighthouse on cliff', tags: ['lighthouse', 'sea', 'cliff', 'coastal', 'storm'] },
  { article: 'a', word: 'historic steam locomotive', scene: 'pulling through a mountain pass', title: 'Steam locomotive', tags: ['train', 'steam', 'retro', 'railway', 'mountain', 'vintage'] },
  { article: 'a', word: 'weathered cowboy', scene: 'staring across a dusty plain', title: 'Cowboy portrait', tags: ['portrait', 'cowboy', 'western', 'person', 'dust'] },
  { article: 'a', word: 'ballerina', scene: 'poised mid-leap in a fading spotlight', title: 'Ballerina on stage', tags: ['ballerina', 'dance', 'portrait', 'stage', 'elegant', 'person'] },
  { article: 'an', word: 'astronaut', scene: 'drifting weightless beside a spacecraft', title: 'Astronaut in space', tags: ['astronaut', 'space', 'scifi', 'portrait', 'zero gravity'] },
  { article: 'a', word: 'samurai warrior', scene: 'kneeling beside a bamboo shrine', title: 'Samurai warrior', tags: ['samurai', 'warrior', 'japan', 'portrait', 'katana', 'bamboo'] },
  { article: 'a', word: 'street musician', scene: 'playing a worn guitar at a subway entrance', title: 'Street musician', tags: ['musician', 'guitar', 'street', 'portrait', 'urban'] },
  { article: 'a', word: 'cheerful chef', scene: 'holding a steaming cast iron pan', title: 'Chef holding pan', tags: ['chef', 'cooking', 'portrait', 'kitchen', 'food'] },
  { article: 'an', word: 'old fisherman', scene: 'mending nets on a weather-beaten dock', title: 'Fisherman on dock', tags: ['fisherman', 'dock', 'sea', 'portrait', 'old'] },
  { article: 'a', word: 'fashion model', scene: 'posing in dramatic studio light', title: 'Fashion portrait', tags: ['portrait', 'fashion', 'studio', 'model', 'elegant'] },
  { article: 'a', word: 'young explorer', scene: 'reading a worn map beside a campfire', title: 'Explorer beside campfire', tags: ['explorer', 'map', 'campfire', 'adventure', 'outdoor', 'portrait'] },
  { article: 'a', word: 'violinist', scene: 'performing in a candlelit hall', title: 'Violinist in candlelit hall', tags: ['violin', 'music', 'performance', 'portrait', 'candlelight', 'elegant'] },
  { article: 'a', word: 'space station', scene: 'orbiting a ringed exoplanet', title: 'Orbiting space station', tags: ['space', 'station', 'scifi', 'orbit', 'planet', 'future'] },
  { article: 'a', word: 'robot gardener', scene: 'tending rows of glowing flowers', title: 'Robot gardener', tags: ['robot', 'garden', 'scifi', 'flowers', 'future', 'cute'] },
  { article: 'a', word: 'titanium android', scene: 'reading braille in a silent library', title: 'Android in library', tags: ['robot', 'android', 'scifi', 'library', 'portrait'] },
  { article: 'a', word: 'fire-breathing dragon', scene: 'circling a ruined castle tower', title: 'Dragon circling castle', tags: ['dragon', 'fantasy', 'castle', 'myth', 'epic'] },
  { article: 'a', word: 'floating castle', scene: 'suspended among cotton-cloud islands', title: 'Floating castle', tags: ['castle', 'fantasy', 'clouds', 'sky', 'soaring'] },
  { article: 'a', word: 'gleaming mars colony', scene: 'spread across a rust-hued valley', title: 'Mars colony', tags: ['mars', 'colony', 'space', 'planet', 'scifi', 'dome'] },
  { article: 'a', word: 'quantum time machine', scene: 'humming inside a brass observatory', title: 'Time machine', tags: ['time machine', 'scifi', 'observatory', 'brass', 'clock', 'inventor'] },
  { article: 'a', word: 'holographic singer', scene: 'performing for a sea of floating drones', title: 'Hologram concert', tags: ['hologram', 'concert', 'neon', 'scifi', 'music', 'future'] },
  { article: 'a', word: 'colossal mech warrior', scene: 'striding through burning fields', title: 'Mech warrior', tags: ['mech', 'robot', 'warrior', 'scifi', 'battle', 'future'] },
  { article: 'an', word: 'alien planet', scene: 'with twin moons rising over violet canyons', title: 'Alien planet', tags: ['alien', 'planet', 'space', 'canyon', 'scifi', 'violet'] },
  { article: 'a', word: 'gnomish workshop', scene: 'filled with ticking brass contraptions', title: 'Gnomish workshop', tags: ['fantasy', 'workshop', 'brass', 'mechanical', 'cozy', 'pocket watch'] },
  { article: 'a', word: 'crystal cavern', scene: 'pulsing with soft bioluminescence', title: 'Crystal cavern', tags: ['cavern', 'crystal', 'minerals', 'underground', 'glow', 'fantasy'] },
  { article: 'a', word: 'vintage café interior', scene: 'with overstuffed leather chairs and old books', title: 'Vintage café', tags: ['cafe', 'vintage', 'interior', 'cozy', 'books', 'leather'] },
  { article: 'a', word: 'corner bakery', scene: 'stacked with golden baguettes at sunrise', title: 'Corner bakery', tags: ['bakery', 'bread', 'morning', 'street', 'cozy'] },
  { article: 'a', word: 'street food stall', scene: 'sizzling with skewers under a canopy of string lights', title: 'Street food stall', tags: ['street food', 'market', 'night', 'cooking', 'lights', 'grill'] },
  { article: 'an', word: 'espresso cup', scene: 'resting beside a spread of morning pastries', title: 'Espresso with pastries', tags: ['coffee', 'espresso', 'breakfast', 'pastry', 'cozy', 'morning'] },
  { article: 'a', word: 'sushi counter', scene: 'with a master chef at work', title: 'Sushi counter', tags: ['sushi', 'japan', 'chef', 'food', 'counter', 'fish'] },
  { article: 'a', word: 'chocolate dessert', scene: 'drizzled with warm salted caramel', title: 'Chocolate dessert', tags: ['dessert', 'chocolate', 'caramel', 'sweet', 'food'] },
  { article: 'a', word: 'rustic breakfast', scene: 'laid out on a farmhouse table', title: 'Farmhouse breakfast', tags: ['breakfast', 'farmhouse', 'wooden table', 'rustic', 'food', 'morning'] },
  { article: 'a', word: 'rooftop cocktail bar', scene: 'overlooking a glittering skyline at dusk', title: 'Rooftop cocktail bar', tags: ['cocktail', 'bar', 'rooftop', 'city', 'dusk', 'drinks'] },
  { article: 'a', word: 'geometric pattern', scene: 'of interlocking triangles and circles', title: 'Geometric abstract', tags: ['abstract', 'geometric', 'pattern', 'shapes', 'modern'] },
  { article: 'a', word: 'fluid gradient', scene: 'of iridescent turquoise and magenta', title: 'Fluid gradient', tags: ['abstract', 'gradient', 'fluid', 'colorful', 'iridescent'] },
  { article: 'a', word: 'pixel wave', scene: 'undulating across a retro screen', title: 'Pixel wave', tags: ['pixel art', 'abstract', 'retro', 'screen', 'wave', 'digital'] },
  { article: 'an', word: 'ink splash', scene: 'blooming across rice paper', title: 'Ink splash', tags: ['ink', 'abstract', 'art', 'dark', 'splash'] },
  { article: 'a', word: 'color field', scene: 'where deep violet bleeds into gold', title: 'Color field painting', tags: ['abstract', 'art', 'violet', 'gold', 'minimalist', 'painting'] },
  { article: 'a', word: 'low-poly island', scene: 'floating in a stylized ocean', title: 'Low-poly island', tags: ['low poly', 'abstract', 'island', 'digital art', 'ocean', '3d'] },
  { article: 'a', word: 'glass prism', scene: 'casting a spectrum across white marble', title: 'Glass prism refraction', tags: ['prism', 'glass', 'refraction', 'abstract', 'light', 'rainbow'] },
  { article: 'a', word: 'swirling nebula', scene: 'of neon particles in a dark void', title: 'Neon nebula', tags: ['nebula', 'space', 'abstract', 'neon', 'particles', 'dark'] },
  { article: 'a', word: 'vintage sports car', scene: 'polished in front of a diner', title: 'Vintage car at diner', tags: ['car', 'vintage', 'diner', 'retro', 'automobile', 'american'] },
  { article: 'a', word: '1960s diner', scene: 'with a crimson neon sign buzzing', title: 'Retro diner', tags: ['diner', 'retro', 'neon', 'american', 'music', 'checkerboard'] },
  { article: 'an', word: 'old typewriter', scene: 'beside a stack of yellowed letters', title: 'Typewriter and letters', tags: ['typewriter', 'retro', 'letters', 'desk', 'vintage', 'writing'] },
  { article: 'a', word: 'record store', scene: 'crammed with vinyl and warm wood', title: 'Record store', tags: ['vinyl', 'record store', 'music', 'retro', 'warm', 'wood'] },
  { article: 'a', word: 'soviet bunker', scene: 'with peeling posters and bare bulbs', title: 'Abandoned bunker', tags: ['bunker', 'abandoned', 'retro', 'industrial', 'brutal'] },
  { article: 'an', word: 'open-air market stall', scene: 'selling hand-woven baskets', title: 'Basket market stall', tags: ['market', 'baskets', 'crafts', 'textiles', 'colorful'] },
];

const STYLES: { name: string; clause: string }[] = [
  { name: 'Photorealistic', clause: 'photorealistic portrait' },
  { name: '3D Render', clause: 'stunning 3D render' },
  { name: 'Oil Painting', clause: 'rich oil painting' },
  { name: 'Watercolor', clause: 'delicate watercolor study' },
  { name: 'Pixel Art', clause: 'retro pixel art scene' },
  { name: 'Anime', clause: 'colorful anime scene' },
  { name: 'Cyberpunk', clause: 'neon-soaked cyberpunk scene' },
  { name: 'Minimalist', clause: 'minimalist composition' },
  { name: 'Surrealist', clause: 'dreamlike surrealist vision' },
  { name: 'Dark Fantasy', clause: 'gloomy dark fantasy tableau' },
  { name: 'Retro', clause: 'warm retro scene' },
  { name: 'Flat Vector', clause: 'bold flat vector illustration' },
];

const MOODS: { name: string; sentence: string; palette: string[] }[] = [
  { name: 'Calm', sentence: 'The scene feels tranquil and unhurried.', palette: ['#8B9DAF', '#D4C5B0', '#5C7A99'] },
  { name: 'Vibrant', sentence: 'The scene bursts with energetic color.', palette: ['#FF6B6B', '#FFD93D', '#6BCB77'] },
  { name: 'Dark', sentence: 'The scene is steeped in shadow and quiet dread.', palette: ['#2F2F3A', '#5C1B1B', '#1A1A2F'] },
  { name: 'Serene', sentence: 'A peaceful stillness settles over the scene.', palette: ['#A8D5BA', '#F4F1DE', '#7A9E9F'] },
  { name: 'Mysterious', sentence: 'An air of quiet mystery hangs in the air.', palette: ['#3D2B56', '#5A3E78', '#22223B'] },
  { name: 'Futuristic', sentence: 'The scene hums with the energy of tomorrow.', palette: ['#7C5CFF', '#00E5FF', '#12002B'] },
  { name: 'Playful', sentence: 'A sense of playful charm fills the frame.', palette: ['#FF9F1C', '#F72585', '#4CC9F0'] },
  { name: 'Dramatic', sentence: 'Dramatic contrast gives the scene cinematic weight.', palette: ['#8B0000', '#2F4F4F', '#E0C097'] },
  { name: 'Romantic', sentence: 'The scene carries a soft, romantic warmth.', palette: ['#F7A6B8', '#C87EA0', '#FFF0F0'] },
  { name: 'Minimalist', sentence: 'Every element feels deliberately placed.', palette: ['#F5F5F5', '#DCDCDC', '#9E9E9E'] },
  { name: 'Retro', sentence: 'A nostalgic warmth colors the whole image.', palette: ['#C97E3E', '#E5B15E', '#4A2A13'] },
  { name: 'Elegant', sentence: 'The composition exudes understated elegance.', palette: ['#2C2C34', '#C9A227', '#1F1F26'] },
];

const USE_CASES: string[] = [
  'Wallpaper',
  'Banner',
  'Editorial',
  'Social Media',
  'Poster',
  'Blog Cover',
  'Album Art',
  'Presentation',
];

const DETAILS: string[] = [
  'bathed in warm golden hour light',
  'with dust motes floating through the air',
  'under a deep indigo sky scattered with stars',
  'while petals drift slowly across the frame',
  'with soft volumetric light spilling through the scene',
  'reflected in a puddle of still water',
  'as distant thunderclouds gather overhead',
  'shrouded in a gentle morning mist',
  'framed by draping vines and wildflowers',
  'caught in the blue glow of a winter dusk',
  'with a single beam of light from a parting cloud',
  'surrounded by a soft out-of-focus bokeh',
  'as fine rain begins to fall in sleek diagonal lines',
  'with long shadows stretching across the ground',
  'emphasized by a razor-thin depth of field',
  'under the pale wash of a rising full moon',
  'streaked with the vivid colors of a far-off storm',
  'while a cooling breeze stirs the leaves',
  'with reflections dancing in glass and chrome',
  'at the precise moment between day and night',
];

// ── Referencias de assets (archivos que sirven la imagen) ───────────────────

export interface AssetRef {
  s3_key: string;
  s3_url: string;
}

// ── API pública ──────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Semilla del PRNG (default 42). Misma semilla → mismo dataset. */
  seed?: number;
  /** Fecha tope; los created_at se reparten hacia atrás desde aquí. */
  startDate?: Date;
  /** Pool de archivos a ciclar para s3_key/s3_url. Si se omite, se generan refs sintéticas. */
  assets?: AssetRef[];
}

const DAY_MS = 86_400_000;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Genera `count` filas `ImageRow` deterministas con metadata rica y variada.
 * Ids: `gen-0001`... sin colisionar con los ids existentes (img-xxx / UUIDs).
 */
/** Ancla fija para created_at — mantiene el dataset determinista entre runs. */
const DEFAULT_ANCHOR = new Date('2026-06-01T00:00:00Z');

export function generateDataset(count: number, opts: GenerateOptions = {}): ImageRow[] {
  const seed = opts.seed ?? 42;
  const startDate = opts.startDate ?? DEFAULT_ANCHOR;
  const assets: AssetRef[] = opts.assets ?? [];

  const rng = mulberry32(seed);
  // Orden de subjects barajado de forma determinista para que 1000 filas
  // no repitan el mismo ciclo visible (i % n) en el mismo orden.
  const subjectOrder = shuffle(rng, SUBJECTS);

  const rows: ImageRow[] = [];
  for (let i = 0; i < count; i++) {
    const subj = subjectOrder[i % subjectOrder.length];
    const style = pick(rng, STYLES);
    const mood = pick(rng, MOODS);
    const useCase = pick(rng, USE_CASES);
    const detail = pick(rng, DETAILS);

    const id = `gen-${String(i + 1).padStart(4, '0')}`;
    const asset = assets.length > 0 ? assets[i % assets.length] : null;
    const ordinal = i + 1;

    const originalPrompt = `${subj.article} ${subj.word} ${subj.scene}`;
    const enhancedPrompt =
      `${style.clause} of ${subj.article} ${subj.word} ${subj.scene}, ${detail}. ${mood.sentence}`;

    // created_at: repartido hacia atrás en ~365 días con jitter (determinista).
    const daysAgo = (ordinal / count) * 365;
    const jitterMs = rng() * 3 * DAY_MS;
    const created = new Date(startDate.getTime() - daysAgo * DAY_MS - jitterMs);

    // Tags = tags del subject + mood (todo único, ordenado).
    const tags = Array.from(new Set([...subj.tags, mood.name.toLowerCase()]));

    rows.push({
      id,
      s3_key: asset?.s3_key ?? `generated/gen-${ordinal}.webp`,
      s3_url: asset?.s3_url ?? `http://localhost:3001/generated/gen-${ordinal}.webp`,
      original_prompt: originalPrompt,
      enhanced_prompt: enhancedPrompt,
      tags,
      style: style.name,
      subject: subj.title,
      mood: mood.name,
      color_palette: mood.palette.slice(),
      use_case: useCase,
      filename: `gen-${ordinal}-${slug(subj.word)}.webp`,
      created_at: created.toISOString(),
    });
  }

  return rows;
}