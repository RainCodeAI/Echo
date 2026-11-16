/**
 * Merging full-text search results from several indexes (pure, tested).
 *
 * Convex search indexes cover one field each, so a note search runs one query
 * per field (transcript, AI summary, AI title). A note that matches in more
 * fields ranks higher; ties keep each index's own relevance order.
 */
export function mergeSearchHits<T extends { _id: string }>(lists: T[][]): T[] {
  const byId = new Map<string, { doc: T; hits: number; best: number }>();
  for (const list of lists) {
    list.forEach((doc, rank) => {
      const seen = byId.get(doc._id);
      if (seen) {
        seen.hits += 1;
        seen.best = Math.min(seen.best, rank);
      } else {
        byId.set(doc._id, { doc, hits: 1, best: rank });
      }
    });
  }
  return [...byId.values()].sort((a, b) => b.hits - a.hits || a.best - b.best).map((x) => x.doc);
}

/** Search terms: trimmed, collapsed, capped (Convex limits terms per query). */
export function normalizeSearch(term: string | undefined): string {
  return (term ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
}
