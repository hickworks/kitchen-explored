#!/usr/bin/env node
// Replaces all http://kitchenexplored.com/slug/ links in post content
// with proper /posts/slug/ relative paths.

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');

// Manual slug remaps for old URLs that don't match the Astro filename exactly
const SLUG_MAP = {
  'ninja-qb1004-blender-food-processor': 'ninja-qb1004',
  'vitamix-e520-vs-7500': 'vitamix-e520-vs-7500-2',
};

// Old-domain URLs that have no content — replace with /posts/ path anyway so
// the 404 page handles them gracefully rather than bouncing to the old site.
// (ninja-bl770-vs-bn801 and ninja-bn701-review-2 have no equivalent post)

// Author / taxonomy pages — map to /about/ or drop the link text to plain text.
// These appear rarely; we'll remap to /about/.
const AUTHOR_RE = /https?:\/\/kitchenexplored\.com\/author\/[^"' )\n]*/g;

const files = fs.readdirSync(CONTENT_DIR)
  .filter(f => f.endsWith('.md') || f.endsWith('.mdx'));

const astroSlugs = new Set(files.map(f => f.replace(/\.(mdx?|md)$/, '')));

let totalFiles = 0;
let totalReplacements = 0;

for (const filename of files) {
  const filePath = path.join(CONTENT_DIR, filename);
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // Replace author archive links → /about/
  content = content.replace(AUTHOR_RE, '/about/');

  // Replace all kitchenexplored.com/slug/ links
  content = content.replace(
    /https?:\/\/kitchenexplored\.com\/([A-Za-z0-9_-]+)\/?/g,
    (fullMatch, slug) => {
      // Apply manual remap if one exists
      const mapped = SLUG_MAP[slug] || slug;
      return `/posts/${mapped}/`;
    }
  );

  if (content !== original) {
    const changes = (original.match(/https?:\/\/kitchenexplored\.com/g) || []).length;
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`  ✓ ${filename}: ${changes} replacement(s)`);
    totalFiles++;
    totalReplacements += changes;
  }
}

console.log(`\nDone. ${totalReplacements} replacements in ${totalFiles} files.`);
