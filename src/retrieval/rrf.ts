/**
 * Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d)). k = 60 is the
 * standard constant; it makes fusion robust to incomparable raw scores.
 */
export interface RankedItem<T> {
  id: string;
  item: T;
}

export function fuseRRF<T>(
  lists: { name: string; items: RankedItem<T>[]; weight?: number }[],
  k = 60,
): { id: string; item: T; score: number; matchedBy: string[] }[] {
  const acc = new Map<string, { item: T; score: number; matchedBy: string[] }>();
  for (const list of lists) {
    const w = list.weight ?? 1;
    list.items.forEach((entry, idx) => {
      const prev = acc.get(entry.id);
      const contribution = w / (k + idx + 1);
      if (prev) {
        prev.score += contribution;
        prev.matchedBy.push(list.name);
      } else {
        acc.set(entry.id, { item: entry.item, score: contribution, matchedBy: [list.name] });
      }
    });
  }
  return [...acc.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score);
}
