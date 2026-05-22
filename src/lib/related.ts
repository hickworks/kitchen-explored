import type { CollectionEntry } from 'astro:content';

function extractModels(slug: string): Set<string> {
  const models = new Set<string>();
  for (const token of slug.split('-')) {
    if (token === 'vs') continue;
    // Alphanumeric mix (e320, bl770, a2500, cfp300) or pure 3-5 digit number (750, 5200, 7500)
    if ((/[a-z]/.test(token) && /\d/.test(token)) || /^\d{3,5}$/.test(token)) {
      models.add(token);
    }
  }
  return models;
}

export function findAlsoCompare(
  currentSlug: string,
  allPosts: CollectionEntry<'posts'>[],
  limit = 4,
): CollectionEntry<'posts'>[] {
  const mine = extractModels(currentSlug);
  if (mine.size === 0) return [];

  return allPosts
    .filter(p => p.id !== currentSlug)
    .map(p => ({
      post: p,
      score: [...extractModels(p.id)].filter(m => mine.has(m)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.post.data.pubDate.valueOf() - a.post.data.pubDate.valueOf(),
    )
    .slice(0, limit)
    .map(({ post }) => post);
}
