/**
 * WordPress XML → Astro Markdown migration script.
 * Usage: node scripts/migrate-wp.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import TurndownService from 'turndown';
import path from 'path';

const XML_FILE  = 'kitchenexplored.WordPress.2026-05-21.xml';
const OUT_DIR   = 'src/content/posts';

// Categories our schema accepts
const VALID_CATEGORIES = new Set([
  'blenders', 'cookware', 'faucet', 'ovens', 'knives', 'pressure-cooker',
]);

// Turndown: HTML → Markdown
const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });

// Strip Gutenberg block comments before converting
function htmlToMarkdown(html) {
  if (!html) return '';
  const cleaned = html
    .replace(/<!-- \/?wp:[^\n]*?-->/g, '')   // remove block comments
    .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '') // remove figure/img blocks
    .replace(/<div[^>]*class="[^"]*wp-block[^"]*"[^>]*>/gi, '<div>') // neutralise block divs
    .trim();
  return td.turndown(cleaned).trim();
}

// Pull a single postmeta value by key from a postmeta array (or single object)
function getMeta(postmeta, key) {
  if (!postmeta) return null;
  const arr = Array.isArray(postmeta) ? postmeta : [postmeta];
  const found = arr.find(m => m['wp:meta_key'] === key);
  return found ? String(found['wp:meta_value'] ?? '').trim() : null;
}

// Sanitise a string for use as a YAML value (wrap in quotes if needed)
function yamlStr(s) {
  if (!s) return '""';
  const escaped = s.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// Convert a date string to ISO date (YYYY-MM-DD)
function toISODate(dateStr) {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  return new Date(dateStr).toISOString().slice(0, 10);
}

// Make a slug safe for filenames
function safeSlug(slug) {
  return slug.replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').toLowerCase();
}

const xml = readFileSync(XML_FILE, 'utf8');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  isArray: (name) => ['item', 'wp:postmeta', 'category'].includes(name),
});

const parsed = parser.parse(xml);
const items  = parsed.rss.channel.item ?? [];

mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
let skipped = 0;

for (const item of items) {
  // Only published posts
  if (item['wp:post_type']?.__cdata !== 'post') { skipped++; continue; }
  if (item['wp:status']?.__cdata !== 'publish')  { skipped++; continue; }

  // Category — find first valid one
  const cats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);
  const catNicename = cats
    .map(c => (c['@_nicename'] ?? '').toLowerCase())
    .find(n => VALID_CATEGORIES.has(n));

  if (!catNicename) { skipped++; continue; } // skip uncategorized / other

  const slug        = item['wp:post_name']?.__cdata ?? safeSlug(item.title?.__cdata ?? 'post');
  const title       = (item.title?.__cdata ?? item.title ?? '').toString().replace(/"/g, '\\"');
  const pubDate     = toISODate(item['wp:post_date']?.__cdata);
  const rawContent  = item['content:encoded']?.__cdata ?? '';
  const postmeta    = item['wp:postmeta'] ?? [];
  const description = (getMeta(postmeta, '_yoast_wpseo_metadesc') ?? '').replace(/"/g, '\\"');

  const body = htmlToMarkdown(rawContent);

  const frontmatter = [
    '---',
    `title: "${title}"`,
    description ? `description: "${description}"` : null,
    `pubDate: ${pubDate}`,
    `category: ${catNicename}`,
    'featured: false',
    '---',
  ].filter(Boolean).join('\n');

  const markdown = `${frontmatter}\n\n${body}\n`;

  const outPath = path.join(OUT_DIR, `${slug}.md`);
  writeFileSync(outPath, markdown, 'utf8');
  written++;
}

console.log(`Done. Written: ${written}  Skipped: ${skipped}`);
