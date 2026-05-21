/**
 * migrate-images.mjs
 *
 * For each post in src/content/posts/:
 *  1. Find its WordPress featured image via the XML export
 *  2. Copy the image from uploads/ → public/uploads/ (preserving year/month dirs)
 *  3. Inject `image:` and `imageAlt:` into the post's frontmatter
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const XML_PATH   = path.join(ROOT, 'kitchenexplored.WordPress.2026-05-21.xml');
const POSTS_DIR  = path.join(ROOT, 'src', 'content', 'posts');
const SRC_UPLOAD = path.join(ROOT, 'uploads');
const DST_UPLOAD = path.join(ROOT, 'public', 'uploads');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pull the first CDATA (or plain text) value from a simple XML tag. */
function extractTag(xml, tag) {
  // Matches <tag><![CDATA[value]]></tag>  OR  <tag>value</tag>
  const re = new RegExp(`<${tag}>[\\s\\S]*?(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, '');
  const m = xml.match(re);
  if (!m) return null;
  return (m[1] !== undefined ? m[1] : m[2] || '').trim();
}

/** Split the whole XML into <item>…</item> blocks. */
function splitItems(xml) {
  const items = [];
  let start = 0;
  while (true) {
    const open  = xml.indexOf('<item>', start);
    if (open === -1) break;
    const close = xml.indexOf('</item>', open);
    if (close === -1) break;
    items.push(xml.slice(open, close + 7));
    start = close + 7;
  }
  return items;
}

/** Extract all <wp:postmeta> blocks from an item string. */
function extractPostMeta(item) {
  const metas = {};
  const re = /<wp:postmeta>([\s\S]*?)<\/wp:postmeta>/g;
  let m;
  while ((m = re.exec(item)) !== null) {
    const block = m[1];
    const key   = extractTag(block, 'wp:meta_key');
    const val   = extractTag(block, 'wp:meta_value');
    if (key) metas[key] = val;
  }
  return metas;
}

// ---------------------------------------------------------------------------
// Parse XML
// ---------------------------------------------------------------------------

console.log('Reading XML…');
const xml = fs.readFileSync(XML_PATH, 'utf8');

console.log('Splitting items…');
const items = splitItems(xml);
console.log(`  Found ${items.length} <item> blocks`);

// { attachmentId: { url, title } }
const attachmentMap = {};
// { slug: { thumbnailId } }
const postMap = {};

for (const item of items) {
  const postType = extractTag(item, 'wp:post_type');

  if (postType === 'attachment') {
    const id  = extractTag(item, 'wp:post_id');
    const url = extractTag(item, 'wp:attachment_url');
    // Title lives in the <title> tag (not wp:post_title)
    const title = extractTag(item, 'title');
    if (id && url) {
      attachmentMap[id] = { url, title: title || '' };
    }
  } else if (postType === 'post') {
    const slug = extractTag(item, 'wp:post_name');
    if (!slug) continue;
    const metas = extractPostMeta(item);
    const thumbnailId = metas['_thumbnail_id'] || null;
    if (thumbnailId) {
      postMap[slug] = { thumbnailId };
    }
  }
}

console.log(`  Parsed ${Object.keys(attachmentMap).length} attachments`);
console.log(`  Parsed ${Object.keys(postMap).length} posts with thumbnails`);

// ---------------------------------------------------------------------------
// Process each Markdown file
// ---------------------------------------------------------------------------

const mdFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
console.log(`\nProcessing ${mdFiles.length} markdown files…`);

let updated  = 0;
let skipped  = 0;
const skipReasons = {};

function bumpSkip(reason) {
  skipped++;
  skipReasons[reason] = (skipReasons[reason] || 0) + 1;
}

for (const filename of mdFiles) {
  const slug = path.basename(filename, '.md');
  const mdPath = path.join(POSTS_DIR, filename);

  // 1. Look up thumbnail
  const postEntry = postMap[slug];
  if (!postEntry) {
    bumpSkip('no thumbnail in WordPress');
    continue;
  }

  const { thumbnailId } = postEntry;
  const attachment = attachmentMap[thumbnailId];
  if (!attachment) {
    bumpSkip('thumbnail ID not found in attachments');
    continue;
  }

  const { url: attachUrl, title: attachTitle } = attachment;

  // 2. Derive paths from URL
  // e.g. https://kitchenexplored.com/wp-content/uploads/2022/11/some-image.jpg
  const WP_BASE = 'https://kitchenexplored.com/wp-content/';
  if (!attachUrl.startsWith(WP_BASE)) {
    bumpSkip('unexpected URL format');
    continue;
  }

  // relative path like "uploads/2022/11/some-image.jpg"
  const relPath = attachUrl.slice(WP_BASE.length);  // e.g. "uploads/2022/11/some.jpg"
  const srcPath = path.join(ROOT, relPath);          // uploads/2022/11/some.jpg

  // If the WordPress-edited variant (filename-eXXXXXXXXX.jpg) is missing,
  // fall back to the original filename without the edit suffix.
  let effectiveSrcPath = srcPath;
  let effectiveRelPath = relPath;
  if (!fs.existsSync(srcPath)) {
    const ext  = path.extname(srcPath);
    const base = path.basename(srcPath, ext).replace(/-e\d+$/, '');
    const dir  = path.dirname(srcPath);
    const fallback = path.join(dir, base + ext);
    if (fs.existsSync(fallback)) {
      effectiveSrcPath = fallback;
      const relDir = path.dirname(relPath);
      effectiveRelPath = relDir + '/' + base + ext;
    } else {
      bumpSkip('source file missing from local uploads/');
      console.warn(`  MISSING: ${relPath}  (post: ${slug})`);
      continue;
    }
  }

  // 3. Copy to public/uploads/...
  const uploadsRel = effectiveRelPath.startsWith('uploads/') ? effectiveRelPath.slice('uploads/'.length) : effectiveRelPath;
  const dstPath = path.join(DST_UPLOAD, uploadsRel);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(effectiveSrcPath, dstPath);

  // Public path for Astro (served from /uploads/...)
  const publicPath = '/' + effectiveRelPath;

  // 4. Update frontmatter
  const mdContent = fs.readFileSync(mdPath, 'utf8');

  // Check whether image fields already exist
  if (/^image:\s/m.test(mdContent)) {
    bumpSkip('image already set');
    continue;
  }

  // Insert after the closing ---
  // Frontmatter format: ---\n...\n---\n
  const fmEnd = mdContent.indexOf('\n---\n', 4); // skip opening ---
  if (fmEnd === -1) {
    bumpSkip('frontmatter closing delimiter not found');
    continue;
  }

  // Determine imageAlt: prefer the post title from the markdown file itself
  // (cleaner than attachment title), fall back to attachment title
  const titleMatch = mdContent.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const imageAlt = titleMatch ? titleMatch[1] : attachTitle;

  // Build lines to inject before the closing ---
  const inject = `image: "${publicPath}"\nimageAlt: "${imageAlt.replace(/"/g, '\\"')}"`;

  const newContent =
    mdContent.slice(0, fmEnd) +
    '\n' + inject +
    mdContent.slice(fmEnd);

  fs.writeFileSync(mdPath, newContent, 'utf8');
  updated++;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n========== SUMMARY ==========');
console.log(`  Updated : ${updated}`);
console.log(`  Skipped : ${skipped}`);
for (const [reason, count] of Object.entries(skipReasons)) {
  console.log(`    • ${reason}: ${count}`);
}
console.log('==============================\n');
