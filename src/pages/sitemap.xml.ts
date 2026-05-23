import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://www.kitchenexplored.com';
const CATEGORIES = ['blenders', 'cookware', 'faucet', 'ovens', 'knives', 'pressure-cooker'];
const PAGE_SIZE = 12;

const STATIC_PAGES = [
  { url: '/', priority: '1.0', changefreq: 'daily' },
  { url: '/about/', priority: '0.5', changefreq: 'monthly' },
  { url: '/contact/', priority: '0.5', changefreq: 'monthly' },
  { url: '/privacy-policy/', priority: '0.3', changefreq: 'yearly' },
  { url: '/terms-of-service/', priority: '0.3', changefreq: 'yearly' },
];

export const GET: APIRoute = async () => {
  const allPosts = await getCollection('posts');

  const entries: string[] = [];

  for (const page of STATIC_PAGES) {
    entries.push(url(SITE + page.url, undefined, page.changefreq, page.priority));
  }

  for (const slug of CATEGORIES) {
    const count = allPosts.filter(p => p.data.category === slug).length;
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    entries.push(url(`${SITE}/category/${slug}/`, undefined, 'weekly', '0.8'));
    for (let p = 2; p <= totalPages; p++) {
      entries.push(url(`${SITE}/category/${slug}/${p}/`, undefined, 'weekly', '0.7'));
    }
  }

  for (const post of allPosts) {
    const lastmod = post.data.pubDate.toISOString().split('T')[0];
    entries.push(url(`${SITE}/posts/${post.id}/`, lastmod, 'monthly', '0.7'));
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};

function url(loc: string, lastmod?: string, changefreq?: string, priority?: string): string {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : '',
    priority ? `    <priority>${priority}</priority>` : '',
    '  </url>',
  ].filter(Boolean).join('\n');
}
