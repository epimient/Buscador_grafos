export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function useDebounce<T>(value: T, ms = 300): T {
  // Hook implementation lives in hooks/useDebounce; kept here as a no-op for tree-shake.
  return value;
}

export function pickImageRatio(id: string | number): number {
  const ratios = [4 / 5, 3 / 4, 1 / 1, 5 / 4, 4 / 3, 16 / 9];
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ratios[h % ratios.length];
}
