/**
 * scrape-and-convert.mjs
 *
 * For every markdown post that contains [wptb id=X] shortcodes:
 *  1. Fetch the live kitchenexplored.com article page
 *  2. Extract each rendered WPTB table's rows and cells
 *  3. Convert the .md file to .mdx, replacing shortcodes with <ComparisonTable /> JSX
 *  4. Delete the original .md file
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');

// Matches all three shortcode variants found in migrated markdown:
//   `[wptb id=123]`   \[wptb id=123\]   [wptb id=123]
const WPTB_RE = /(?:`\[wptb id=(\d+)\]`|\\\[wptb id=(\d+)\\\]|\[wptb id=(\d+)\])/g;

function extractId(match) {
  return match[1] ?? match[2] ?? match[3];
}

// ---------------------------------------------------------------------------
// HTTP fetch (no external deps)
// ---------------------------------------------------------------------------
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(chunks.join('')));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Parse one WPTB table from the page HTML by its numeric ID
// Returns { headers: string[], rows: Cell[][] } or null
// ---------------------------------------------------------------------------
function parseTable(html, tableId) {
  const marker = `wptb-table-${tableId}`;
  const start  = html.indexOf(marker);
  if (start === -1) return null;

  // Walk forward to the enclosing <table>…</table>
  const tableOpen  = html.indexOf('<table', start);
  const tableClose = html.indexOf('</table>', tableOpen);
  if (tableOpen === -1 || tableClose === -1) return null;
  const tableHtml = html.slice(tableOpen, tableClose + 8);

  // Split into rows
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const rows = [];
  let rm;
  while ((rm = rowPattern.exec(tableHtml)) !== null) {
    rows.push({ html: rm[0], inner: rm[1] });
  }
  if (rows.length === 0) return null;

  // Determine which row is the header
  const headerRowIdx = rows.findIndex(r => r.html.includes('wptb-table-head'));
  const headerRow = headerRowIdx >= 0 ? rows[headerRowIdx] : rows[0];
  const dataRows  = rows.filter((_, i) => i !== (headerRowIdx >= 0 ? headerRowIdx : 0));

  const parseRow = (rowHtml) => {
    const cells = [];
    const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tm;
    while ((tm = tdPattern.exec(rowHtml)) !== null) {
      const inner = tm[1];
      // Extract href from any anchor in this cell
      const hrefMatch = inner.match(/href="([^"]+)"/);
      const href = hrefMatch ? hrefMatch[1] : undefined;

      // Plain text (strip all tags, collapse whitespace)
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ').trim();

      // A cell is a "button" if:
      //  - the container div has "button" in its class, OR
      //  - the text looks like a CTA (Buy, Check, Shop, View, Get)
      const isButtonContainer = /class="[^"]*button[^"]*"/.test(inner);
      const isCtaText = /^(buy|check\s+price|shop|view\s+(deal|price)|get\s+it)/i.test(text);
      const isButton = href ? (isButtonContainer || isCtaText) : false;

      cells.push({ text, ...(href && { href }), ...(isButton && { isButton: true }) });
    }
    return cells;
  };

  const headers = parseRow(headerRow.inner).map(c => c.text);
  const parsedRows = dataRows.map(r => parseRow(r.inner));

  return { headers, rows: parsedRows };
}

// ---------------------------------------------------------------------------
// Serialize table data as JSX prop strings for the MDX component
// ---------------------------------------------------------------------------
function serializeCell(cell) {
  const parts = [`text: ${JSON.stringify(cell.text)}`];
  if (cell.href)     parts.push(`href: ${JSON.stringify(cell.href)}`);
  if (cell.isButton) parts.push(`isButton: true`);
  return `{${parts.join(', ')}}`;
}

function tableToJsx(tableId, tableData) {
  const headersJson = JSON.stringify(tableData.headers);
  const rowsStr = tableData.rows
    .map(row => `    [${row.map(serializeCell).join(', ')}]`)
    .join(',\n');
  return `<ComparisonTable\n  headers={${headersJson}}\n  rows={[\n${rowsStr}\n  ]}\n/>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const mdFiles = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));

// Build: slug → Set of table IDs
const slugToIds = new Map();
for (const filename of mdFiles) {
  const slug    = path.basename(filename, '.md');
  const content = fs.readFileSync(path.join(POSTS_DIR, filename), 'utf8');
  const ids     = new Set();
  let m;
  WPTB_RE.lastIndex = 0;
  while ((m = WPTB_RE.exec(content)) !== null) ids.add(extractId(m));
  if (ids.size > 0) slugToIds.set(slug, ids);
}

console.log(`Posts with WPTB shortcodes: ${slugToIds.size}`);

// Fetch pages and build tableId → parsed data map
const tableCache = new Map(); // id → tableData | null
let fetchCount = 0;

for (const [slug, ids] of slugToIds) {
  const url = `https://kitchenexplored.com/${slug}/`;
  process.stdout.write(`Fetching ${slug} … `);
  fetchCount++;

  let html;
  try {
    html = await fetchPage(url);
    console.log('OK');
  } catch (e) {
    console.log(`FAIL (${e.message})`);
    for (const id of ids) tableCache.set(id, null);
    await sleep(500);
    continue;
  }

  for (const id of ids) {
    if (!tableCache.has(id)) {
      const data = parseTable(html, id);
      tableCache.set(id, data);
      if (!data) console.warn(`  ⚠ Table ${id} not found on page`);
    }
  }

  await sleep(600); // ~100 req/min, polite crawl rate
}

console.log(`\nFetched ${fetchCount} pages, parsed ${[...tableCache.values()].filter(Boolean).length} tables`);

// Convert .md → .mdx
let converted = 0, skipped = 0;

for (const [slug, ids] of slugToIds) {
  const mdPath  = path.join(POSTS_DIR, `${slug}.md`);
  const mdxPath = path.join(POSTS_DIR, `${slug}.mdx`);

  // Check all needed tables were found
  const missing = [...ids].filter(id => !tableCache.get(id));
  if (missing.length > 0) {
    console.warn(`SKIP ${slug} — missing table data for IDs: ${missing.join(', ')}`);
    skipped++;
    continue;
  }

  let content = fs.readFileSync(mdPath, 'utf8');

  // Find where frontmatter ends and content begins
  const fmEnd = content.indexOf('\n---\n', 4);
  if (fmEnd === -1) { console.warn(`SKIP ${slug} — no frontmatter`); skipped++; continue; }
  const frontmatter = content.slice(0, fmEnd + 5);
  let body = content.slice(fmEnd + 5);

  // Add the import statement at the top of the body
  const importLine = `import ComparisonTable from '../../components/ComparisonTable.astro';\n\n`;

  // Replace all shortcode variants with JSX
  WPTB_RE.lastIndex = 0;
  body = body.replace(WPTB_RE, (match, ...groups) => {
    const id = groups[0] ?? groups[1] ?? groups[2];
    const data = tableCache.get(id);
    if (!data) return match; // leave unchanged if no data
    return tableToJsx(id, data);
  });

  const mdxContent = frontmatter + importLine + body;
  fs.writeFileSync(mdxPath, mdxContent, 'utf8');
  fs.unlinkSync(mdPath);
  converted++;
}

console.log(`\n========== SUMMARY ==========`);
console.log(`  Converted to MDX : ${converted}`);
console.log(`  Skipped          : ${skipped}`);
console.log(`==============================\n`);
