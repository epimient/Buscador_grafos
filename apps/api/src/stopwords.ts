/**
 * Stopwords en español para búsqueda VORAEL.
 *
 * Estos términos aportan estructura gramatical pero casi nunca *significado*
 * de búsqueda: "una persona parada DE FRENTE A una sala DE control" tiene 8
 * tokens pero solo 4 con peso real (persona, parada, sala, control). Contarlos
 * como iguales infla la cobertura mínima y mete ruido (resultados que coinciden
 * solo en "de", "frente", "a").
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // determinantes y artículos
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'ese', 'esa', 'esos', 'esas', 'este', 'esta', 'estos', 'estas',
  'aquel', 'aquella', 'aquellos', 'aquellas',
  'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'nuestro', 'nuestra',
  // preposiciones
  'a', 'ante', 'bajo', 'con', 'contra', 'de', 'desde', 'en', 'entre',
  'hacia', 'hasta', 'para', 'por', 'según', 'sin', 'sobre', 'tras', 'según',
  // conjunciones
  'y', 'e', 'o', 'u', 'ni', 'pero', 'sino', 'porque', 'que',
  // verbos y auxiliares comunes
  'es', 'ser', 'está', 'esta', 'estar', 'son', 'fue', 'era', 'ha', 'haber',
  'hay', 'tiene', 'tener', 'están', 'hacer',
  // formas de "de frente a" (la persona parada SÍ discrimina: "persona parada")
  'frente',
  // otros genéricos frecuentes
  'allí', 'ahí', 'así', 'más', 'menos', 'muy', 'mucho', 'muchos', 'bien',
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token.toLowerCase());
}

/**
 * Términos con contenido semántico de una query, en minúsculas y sin duplicados.
 * Filtra stopwords. Si la query queda vacía (p. ej. "de"), devuelve los tokens
 * originales para no perder la búsqueda.
 */
export function meaningfulTerms(q: string): string[] {
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const meaningful = [...new Set(tokens.filter((t) => !isStopword(t)))];
  return meaningful.length > 0 ? meaningful : [...new Set(tokens)];
}