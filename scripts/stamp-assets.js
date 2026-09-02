#!/usr/bin/env node
/**
 * Stamp local asset URLs in index.html with a content hash.
 *
 * Cloudflare Pages serves static assets with Cache-Control: max-age=14400 and
 * overrides anything shorter, whether it is set in _headers or in the Pages
 * Function middleware. index.html itself is always revalidated, so a returning
 * visitor could run brand new markup against up-to-four-hour-old JavaScript —
 * which is exactly how the report language switch shipped: the buttons
 * rendered, and nothing was listening to them.
 *
 * Stamping the references makes the URL change whenever the file changes, so a
 * fresh index.html can never point at a stale asset. Run it before deploying;
 * the hashes are derived from file contents, so re-running without source
 * changes rewrites nothing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX = path.join(PUBLIC_DIR, 'index.html');

// src="app.js"  href="styles.css"  src="lib/signal.js?v=old"
const REFERENCE = /(\s(?:src|href)=")([^"?#:]+\.(?:js|css))(?:\?v=[a-f0-9]+)?(")/g;

function hashOf(relativePath) {
  const filePath = path.join(PUBLIC_DIR, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('md5').update(fs.readFileSync(filePath)).digest('hex').slice(0, 10);
}

function stamp() {
  const original = fs.readFileSync(INDEX, 'utf8');
  const missing = [];
  const stamped = [];

  const updated = original.replace(REFERENCE, (match, prefix, asset, suffix) => {
    const hash = hashOf(asset);
    if (!hash) {
      missing.push(asset);
      return match;
    }
    stamped.push(`${asset}?v=${hash}`);
    return `${prefix}${asset}?v=${hash}${suffix}`;
  });

  if (missing.length) {
    console.error(`stamp-assets: referenced file(s) not found in public/: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (updated === original) {
    console.log(`stamp-assets: index.html already current (${stamped.length} assets)`);
    return;
  }

  fs.writeFileSync(INDEX, updated);
  console.log(`stamp-assets: updated index.html`);
  stamped.forEach(entry => console.log(`  ${entry}`));
}

stamp();
