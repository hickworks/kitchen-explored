#!/usr/bin/env node
// Finds every remaining amzn.to link in the posts directory,
// follows the redirect, swaps the tag to ke2024-20, and rewrites in-place.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'posts');
const NEW_TAG = 'ke2024-20';
const BATCH = 15;
const SHORT_LINK_RE = /https:\/\/amzn\.to\/[A-Za-z0-9]+/g;

function followRedirects(startUrl, maxHops = 8) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    function req(currentUrl) {
      const parsed = new URL(currentUrl);
      const lib = parsed.protocol === 'https:' ? https : http;
      const r = lib.request(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
          method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 },
        (res) => {
          res.destroy();
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (++hops > maxHops) return reject(new Error('too many redirects'));
            try { req(new URL(res.headers.location, currentUrl).toString()); }
            catch (e) { reject(e); }
          } else {
            resolve(currentUrl);
          }
        }
      );
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
      r.end();
    }
    req(startUrl);
  });
}

function swapTag(amazonUrl) {
  try {
    const u = new URL(amazonUrl);
    if (u.searchParams.has('tag')) u.searchParams.set('tag', NEW_TAG);
    return u.toString();
  } catch { return amazonUrl; }
}

async function run() {
  // Collect all unique short links across all files
  const files = fs.readdirSync(CONTENT_DIR)
    .filter(f => f.endsWith('.md') || f.endsWith('.mdx'))
    .map(f => path.join(CONTENT_DIR, f));

  const linkToFiles = new Map(); // shortUrl -> Set of file paths
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const match of content.matchAll(SHORT_LINK_RE)) {
      const url = match[0];
      if (!linkToFiles.has(url)) linkToFiles.set(url, new Set());
      linkToFiles.get(url).add(filePath);
    }
  }

  const uniqueLinks = [...linkToFiles.keys()];
  console.log(`Found ${uniqueLinks.length} unique amzn.to links across ${files.length} files.\n`);

  // Resolve all links in batches
  const resolved = new Map(); // shortUrl -> newUrl
  const failed = [];

  for (let i = 0; i < uniqueLinks.length; i += BATCH) {
    const batch = uniqueLinks.slice(i, i + BATCH);
    await Promise.all(batch.map(async (shortUrl) => {
      try {
        const finalUrl = await followRedirects(shortUrl);
        resolved.set(shortUrl, swapTag(finalUrl));
      } catch (err) {
        console.error(`  FAIL ${shortUrl}: ${err.message}`);
        failed.push(shortUrl);
      }
    }));
    console.log(`  ${Math.min(i + BATCH, uniqueLinks.length)}/${uniqueLinks.length} resolved`);
  }

  // Apply replacements file by file
  let totalFiles = 0;
  let totalReplacements = 0;

  for (const filePath of files) {
    let content = fs.readFileSync(filePath, 'utf-8');
    let count = 0;
    // Replace each short link found in this file
    content = content.replace(SHORT_LINK_RE, (match) => {
      const newUrl = resolved.get(match);
      if (newUrl && newUrl !== match) { count++; return newUrl; }
      return match;
    });
    if (count > 0) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`  ✓ ${path.basename(filePath)}: ${count} replacement(s)`);
      totalFiles++;
      totalReplacements += count;
    }
  }

  console.log(`\nDone. ${totalReplacements} replacements in ${totalFiles} files.`);
  if (failed.length) console.log(`${failed.length} links failed to resolve — check output above.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
