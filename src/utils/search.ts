/**
 * Buscador en memoria local portado de Nodux Flow (frontend/src/lib/search.js).
 * Cero llamadas HTTP, respuesta sub-milisegundo, tolerante a tildes y puntuación.
 */

export function normalizeSearchText(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0000-\u001f\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(s: string): string {
  return s.replace(/[^a-z0-9]/g, '');
}

export interface SearchableEntry<T> {
  item: T;
  index: number;
  primaryCompact: string;
  haystack: string;
}

export function buildSearchIndex<T>(
  items: readonly T[],
  getFields: (item: T) => { primary: string; secondary: string[] }
): SearchableEntry<T>[] {
  return items.map((item, index) => {
    const { primary, secondary } = getFields(item);
    const pNorm = normalizeSearchText(primary);
    const pComp = compact(pNorm);
    const secNorm = secondary.map(normalizeSearchText).join(' ');
    return {
      item,
      index,
      primaryCompact: pComp,
      haystack: ` ${pNorm} ${pComp} ${secNorm} `,
    };
  });
}

export function searchIndex<T>(entries: readonly SearchableEntry<T>[], query: string): T[] {
  const q = normalizeSearchText(query);
  if (!q) return entries.map((e) => e.item);

  const tokens = q.split(' ').filter(Boolean);
  const qc = compact(q);
  const scored: Array<[SearchableEntry<T>, number]> = [];

  for (const e of entries) {
    const allTokens = tokens.every((t) => e.haystack.includes(t));
    const directHit = qc.length >= 3 && e.primaryCompact.includes(qc);
    if (!allTokens && !directHit) continue;

    let score = 0;
    if (e.primaryCompact === qc) score += 1000;
    else if (e.primaryCompact.startsWith(qc)) score += 200;
    else if (directHit) score += 80;
    for (const t of tokens) {
      if (e.haystack.includes(` ${t}`)) score += 15;
    }
    scored.push([e, score]);
  }

  return scored
    .sort((a, b) => b[1] - a[1] || a[0].index - b[0].index)
    .map(([e]) => e.item);
}
