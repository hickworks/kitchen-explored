#!/usr/bin/env node
// Follows each flagged amzn.to redirect, swaps the tag to ke2024-20,
// then replaces the short URL in-place in the markdown files.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');
const REPORT_FILE = path.join(__dirname, '..', 'affiliate-links-to-fix.md');
const NEW_TAG = 'ke2024-20';
const BATCH = 15;

function followRedirects(startUrl, maxHops = 8) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    function req(currentUrl) {
      const parsed = new URL(currentUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 12000,
      };
      const r = lib.request(options, (res) => {
        res.destroy(); // don't read body
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (++hops > maxHops) return reject(new Error('too many redirects'));
          try {
            req(new URL(res.headers.location, currentUrl).toString());
          } catch (e) { reject(e); }
        } else {
          resolve(currentUrl);
        }
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
      r.end();
    }
    req(startUrl);
  });
}

function swapTag(amazonUrl, newTag) {
  try {
    const u = new URL(amazonUrl);
    if (u.searchParams.has('tag')) {
      u.searchParams.set('tag', newTag);
    }
    return u.toString();
  } catch {
    return amazonUrl;
  }
}

function parseReport(content) {
  const links = [];
  let cur = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^\*\*(https:\/\/amzn\.to\/\S+)\*\*$/);
    if (m) {
      if (cur) links.push(cur);
      cur = { shortUrl: m[1], files: [] };
    } else if (cur && line.startsWith('- ')) {
      cur.files.push(line.slice(2).trim());
    }
  }
  if (cur) links.push(cur);
  return links;
}

async function run() {
  const report = fs.readFileSync(REPORT_FILE, 'utf-8');
  const links = parseReport(report);
  console.log(`Found ${links.length} links to process.\n`);

  const resolved = [];
  for (let i = 0; i < links.length; i += BATCH) {
    const batch = links.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (link) => {
      try {
        const finalUrl = await followRedirects(link.shortUrl);
        const newUrl = swapTag(finalUrl, NEW_TAG);
        return { ...link, finalUrl, newUrl, ok: true };
      } catch (err) {
        console.error(`  FAIL ${link.shortUrl}: ${err.message}`);
        return { ...link, finalUrl: null, newUrl: null, ok: false };
      }
    }));
    resolved.push(...results);
    const done = Math.min(i + BATCH, links.length);
    console.log(`  ${done}/${links.length} resolved`);
  }

  // Group replacements by file
  const byFile = {};
  for (const r of resolved) {
    if (!r.ok) continue;
    for (const f of r.files) {
      (byFile[f] = byFile[f] || []).push({ from: r.shortUrl, to: r.newUrl });
    }
  }

  let totalFiles = 0;
  let totalReplacements = 0;

  for (const [filename, replacements] of Object.entries(byFile)) {
    const filePath = path.join(CONTENT_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`  NOT FOUND: ${filename}`);
      continue;
    }
    let content = fs.readFileSync(filePath, 'utf-8');
    let fileCount = 0;
    for (const { from, to } of replacements) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = (content.match(new RegExp(escaped, 'g')) || []).length;
      if (matches) {
        content = content.replace(new RegExp(escaped, 'g'), to);
        fileCount += matches;
      }
    }
    if (fileCount > 0) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`  ✓ ${filename}: ${fileCount} replacement(s)`);
      totalFiles++;
      totalReplacements += fileCount;
    }
  }

  const failed = resolved.filter(r => !r.ok).length;
  console.log(`\nDone. ${totalReplacements} replacements in ${totalFiles} files.`);
  if (failed) console.log(`${failed} links failed to resolve — check output above.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
