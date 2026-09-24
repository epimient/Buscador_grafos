import { describe, it, expect } from 'vitest';
import { isStopword, meaningfulTerms, STOPWORDS } from '../src/stopwords';

describe('isStopword', () => {
  it('reconoce determinantes y preposiciones', () => {
    expect(isStopword('de')).toBe(true);
    expect(isStopword('una')).toBe(true);
    expect(isStopword('frente')).toBe(true);
    expect(isStopword('a')).toBe(true);
    expect(isStopword('el')).toBe(true);
    expect(isStopword('para')).toBe(true);
  });

  it('es insensible a mayúsculas', () => {
    expect(isStopword('UNA')).toBe(true);
    expect(isStopword('De')).toBe(true);
    expect(isStopword('FRENTE')).toBe(true);
  });

  it('no marca palabras con contenido', () => {
    expect(isStopword('gato')).toBe(false);
    expect(isStopword('sala')).toBe(false);
    expect(isStopword('control')).toBe(false);
    expect(isStopword('neon')).toBe(false);
  });
});

describe('meaningfulTerms', () => {
  it('filtra stopwords y elimina duplicados', () => {
    expect(meaningfulTerms('una persona de frente a una sala')).toEqual([
      'persona',
      'sala',
    ]);
  });

  it('conserva solo los tokens significativos de un párrafo', () => {
    const r = meaningfulTerms(
      'una persona parada de frente a una sala de control',
    );
    expect(r).toContain('persona');
    expect(r).toContain('parada');
    expect(r).toContain('sala');
    expect(r).toContain('control');
    expect(r).not.toContain('una');
    expect(r).not.toContain('de');
    expect(r).not.toContain('frente');
    expect(r).not.toContain('a');
  });

  it('hace fallback a tokens crudos deduplicados si todo era stopword', () => {
    expect(meaningfulTerms('de la una a la')).toEqual(['de', 'la', 'una', 'a']);
  });

  it('no rompe con query vacía o espacios', () => {
    expect(meaningfulTerms('')).toEqual([]);
    expect(meaningfulTerms('    ')).toEqual([]);
  });

  it('la lista de stopwords está poblada', () => {
    expect(STOPWORDS.size).toBeGreaterThanOrEqual(40);
  });
});