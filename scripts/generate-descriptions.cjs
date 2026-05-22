#!/usr/bin/env node
// Extracts the first substantive prose paragraph from each post
// and injects it as a `description:` field in the frontmatter.

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');
const MAX_LEN = 155;

function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](url) → text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images → removed
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')    // bold/italic → text
    .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')       // underscores → text
    .replace(/`[^`]+`/g, '')                      // inline code → removed
    .replace(/<[^>]+>/g, '')                      // HTML tags → removed
    .replace(/&#\d+;/g, '')                       // HTML entities → removed
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\\/g, '')                           // escape chars
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max) + '…';
}

function extractDescription(raw) {
  // Remove frontmatter
  const body = raw.replace(/^---[\s\S]*?---\n/, '').trimStart();

  const lines = body.split('\n');
  const candidates = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blanks, imports, headings, component tags, horizontal rules, list markers
    if (!trimmed) continue;
    if (/^import\s/.test(trimmed)) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^<[A-Z]/.test(trimmed)) continue;       // JSX components
    if (/^\s*[-*]/.test(trimmed)) continue;       // list items
    if (/^[|]/.test(trimmed)) continue;           // table rows
    if (/^---/.test(trimmed)) continue;            // hr
    if (/^\d+\./.test(trimmed)) continue;         // ordered list

    const clean = stripMarkdown(trimmed);
    if (clean.length < 30) continue;              // skip very short lines

    // Prefer sentences that don't start with "Yes," / "No," / interrogatives alone
    candidates.push(clean);
    if (clean.length >= 80) break;               // good enough, stop
  }

  if (candidates.length === 0) return null;

  // Pick the longest candidate up to MAX_LEN
  const best = candidates.reduce((a, b) => (a.length >= b.length ? a : b));
  return truncate(best, MAX_LEN);
}

const files = fs.readdirSync(CONTENT_DIR)
  .filter(f => f.endsWith('.md') || f.endsWith('.mdx'));

let updated = 0;
let skipped = 0;
const noDesc = [];

for (const filename of files) {
  const filePath = path.join(CONTENT_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf-8');

  // Skip if already has description
  if (/^description:/m.test(content)) { skipped++; continue; }

  const desc = extractDescription(content);
  if (!desc) { noDesc.push(filename); continue; }

  // Inject after the last frontmatter field before closing ---
  // Find the closing --- of frontmatter
  const fmEnd = content.indexOf('\n---\n', 4);
  if (fmEnd === -1) { noDesc.push(filename); continue; }

  const newContent =
    content.slice(0, fmEnd) +
    `\ndescription: "${desc.replace(/"/g, "'")}"` +
    content.slice(fmEnd);

  fs.writeFileSync(filePath, newContent, 'utf-8');
  updated++;
}

console.log(`Updated: ${updated} files`);
console.log(`Already had description: ${skipped}`);
if (noDesc.length) {
  console.log(`Could not extract description (${noDesc.length}):`);
  noDesc.forEach(f => console.log('  ', f));
}
