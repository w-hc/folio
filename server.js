#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { renderMarkdown } = require('./markdown');
const { initHighlighter, highlightCode, langFromExt } = require('./highlight');

// --- CLI args ---
const { parseArgs } = require('util');
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    port: { type: 'string', default: '3000' },
    dev:  { type: 'boolean', default: false },
  },
  allowPositionals: true,
});
const port = parseInt(values.port, 10);
const IS_DEV = values.dev;
let FS_ROOT = positionals[0] || '.';
// Use realpath so the root matches what realpath returns for children.
// On macOS, /tmp → /private/tmp, so without this the security check would
// reject every file under /tmp.
FS_ROOT = fs.realpathSync(path.resolve(FS_ROOT));

// --- Constants ---
const MAX_TEXT_SIZE = 2 * 1024 * 1024; // 2 MB
const SERVER_ID = Date.now().toString();

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const UI_COLOR = 'text-indigo-500';

// --- HTML tagged template ---
//
// html`<p>${userInput}</p>` auto-escapes interpolated values.
// Use raw() to inject pre-built HTML without escaping.
// Arrays are joined automatically (useful for .map() lists).
//
// Returns a raw()-wrapped result, so html`` calls nest safely:
//   html`<ul>${html`<li>${name}</li>`}</ul>`  -- inner result is trusted HTML

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Symbol key ensures raw markers can't collide with user data.
// raw() wraps a string to skip escaping: html`<div>${raw(preBuiltHtml)}</div>`
const RAW = Symbol('raw');
function raw(str) { return { [RAW]: str }; }

function resolve(val) {
  if (val && val[RAW] !== undefined) return val[RAW];
  return escapeHtml(String(val));
}

// Tagged template function. JavaScript calls it automatically when you write html`...`.
// It receives the template split into static strings and dynamic values:
//
//   html`<a href="${url}">${name}</a>`
//
//   strings: ['<a href="',  '">',  '</a>']    ← K+1 static pieces
//   values:  [url,          name]              ← K dynamic pieces
//
// There's always one more string than values (the template starts and ends with
// a static piece, even if empty). So we zip them back together:
//
//   strings[0] + resolve(values[0]) + strings[1] + resolve(values[1]) + strings[2]
//   '<a href="' +  escaped(url)     +   '">'      +   escaped(name)   +  '</a>'
//
// resolve() escapes values by default, unless they're raw()-wrapped or arrays.
function html(strings, ...values) {
  let result = strings[0];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    result += Array.isArray(val) ? val.map(resolve).join('') : resolve(val);
    result += strings[i + 1];
  }
  return raw(result);
}

// --- HTML helpers ---

// Minimal CSS for things Tailwind can't handle (katex overflow, markdown tables).
const CSS = `
.katex { font-size: 1.1em !important; }
.katex-display { margin: 0.05rem 0 !important; overflow-x: auto; overflow-y: hidden; }
.katex-play-nice .katex { font-weight: inherit; font-style: inherit; text-decoration: inherit; color: inherit; }
article table { border-collapse: collapse; width: 100%; overflow-x: auto; display: block; }
article th, article td { border: 1px solid #ddd; padding: 8px; text-align: left; }
article th { background: #f6f8fa; }`;

// page() returns a plain string (via [RAW]) since it's the outermost call —
// the HTTP response needs a string, not a raw-wrapped object.
// extraHead is optional — used by serveMarkdown to include KaTeX CSS
// only on pages that need it.
function page(title, body, extraHead = raw('')) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  ${extraHead}
  <style>${raw(CSS)}</style>
  ${raw(IS_DEV ? `<script>
    (function() {
      var id;
      setInterval(function() {
        fetch('/__livereload')
          .then(function(r) { return r.text(); })
          .then(function(newId) {
            if (!id) id = newId;
            else if (id !== newId) location.reload();
          })
          .catch(function() {});
      }, 300);
    })();
  </script>` : '')}
</head>
<body class="max-w-5xl mx-auto p-4">
  ${body}
</body>
</html>`[RAW];
}

// Builds clickable breadcrumb navigation: root / notes / math /
//
// URLs need special characters encoded (spaces → %20, parens → %28%29, etc.)
// or the browser can't parse them. We use encodeURIComponent() for this.
//
// Example: path "/my notes/math (1)" becomes
//   href:    /my%20notes/math%20%281%29   ← valid URL for the browser
//   display: root / my notes / math (1)   ← readable text for the user
function breadcrumb(urlPath) {
  const segments = urlPath.split('/').filter(Boolean);
  let hrefSoFar = '';  // accumulate the links of the prefix segments
  const links = segments.map(seg => {
    hrefSoFar += '/' + encodeURIComponent(seg);
    return html` / <a class="${UI_COLOR} hover:underline" href="${raw(hrefSoFar)}">${decodeURIComponent(seg)}</a>`;
  });
  return html`
    <div class="mb-4">
      <a class="${UI_COLOR} hover:underline" href="/">root</a>
      ${links}
    </div>
  `;
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (i < units.length - 1 && bytes >= 1024) { bytes /= 1024; i++; }
  return (i === 0 ? bytes : bytes.toFixed(1)) + ' ' + units[i];
}

function sendHtml(res, output) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(output);
}

// --- Route handlers ---

async function serveDirectory(req, res, fsPath, urlPath) {
  // Each entry's href will be set to its filename (e.g. <a href="file.md">).
  // The browser joins that with the current URL to form the full path.
  // This only works if the URL ends with "/":
  //   /notes/ + file.md → /notes/file.md (correct)
  //   /notes  + file.md → /file.md       (wrong)
  if (!urlPath.endsWith('/')) {
    res.writeHead(301, { Location: urlPath + '/' });
    res.end();
    return;
  }

  const entries = await fs.promises.readdir(fsPath, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort();

  // Stat each file for size display
  const fileItems = await Promise.all(files.map(async name => {
    let size = '';
    try {
      const stat = await fs.promises.stat(path.join(fsPath, name));
      size = formatSize(stat.size);
    } catch { /* ignore */ }
    return { name, href: encodeURIComponent(name), size };
  }));

  const title = urlPath === '/' ? 'root' : path.basename(fsPath);
  // Hrefs are URL-encoded so they don't need HTML-escaping — wrap in raw() to skip it
  sendHtml(res, page(title, html`
    ${breadcrumb(urlPath)}
    <ul class="list-none font-mono tracking-tighter space-y-2 ${UI_COLOR}">
      ${dirs.map(name => html`
        <li class="hover:underline">
          \u{1F4C1} <a href="${raw(encodeURIComponent(name) + '/')}">${name}/</a>
        </li>
      `)}
      ${fileItems.map(f => html`
        <li class="hover:underline">
          <a href="${raw(f.href)}">${f.name}</a>
          <span class="text-gray-500 text-sm ml-2">${f.size}</span>
        </li>
      `)}
    </ul>
  `));
}

// Shiki inlines its own styles, so only KaTeX CSS is needed from CDN.
const MARKDOWN_HEAD = html`
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">`;

async function serveMarkdown(req, res, fsPath, urlPath) {
  const content = await fs.promises.readFile(fsPath, 'utf-8');
  const name = path.basename(fsPath);
  const rendered = renderMarkdown(content);
  sendHtml(
    res, page(
      name,
      html`
        ${breadcrumb(urlPath)}
        <article class="prose max-w-none katex-play-nice text-base">
          ${raw(rendered)}
        </article>
      `,
      MARKDOWN_HEAD
    )
  );
}

function serveBinary(req, res, fsPath) {
  const ext = path.extname(fsPath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  fs.createReadStream(fsPath).pipe(res);
}

async function serveRawText(req, res, fsPath, urlPath) {
  const stat = await fs.promises.stat(fsPath);
  const name = path.basename(fsPath);

  // Only applies to text files rendered in <pre>. Binary files (images, PDFs) go
  // through serveBinary() which streams without loading into memory.
  if (stat.size > MAX_TEXT_SIZE) {
    sendHtml(res, page(name, html`
      ${breadcrumb(urlPath)}
      <h2>${name}</h2>
      <p>File is too large to display (${formatSize(stat.size)}).</p>
      <div class="mt-10 text-center">
        <a class="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
           href="${raw(urlPath + '?raw=1')}" download>
          Download file
        </a>
      </div>
    `));
    return;
  }

  const content = await fs.promises.readFile(fsPath, 'utf-8');
  const lang = langFromExt(path.extname(fsPath).toLowerCase());
  const highlighted = lang ? highlightCode(content, lang) : null;

  sendHtml(res, page(name, html`
    ${breadcrumb(urlPath)}
    <div class="text-sm my-4 p-4 bg-gray-50 overflow-auto">
      ${highlighted ? raw(highlighted) : html`<pre><code>${content}</code></pre>`}
    </div>
  `));
}

function serveRawDownload(req, res, fsPath) {
  const name = path.basename(fsPath);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
  });
  fs.createReadStream(fsPath).pipe(res);
}

// --- Main handler ---

async function handler(req, res) {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);

    if (IS_DEV && parsed.pathname === '/__livereload') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(SERVER_ID);
      return;
    }

    const urlPath = decodeURIComponent(parsed.pathname);

    // Security: two checks prevent escaping the served root.
    // 1) path.resolve normalizes away ".." — reject if result leaves root.
    let fsPath = path.resolve(path.join(FS_ROOT, urlPath));
    if (!fsPath.startsWith(FS_ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // 2) realpath resolves symlinks — a symlink inside root could point anywhere.
    try {
      fsPath = await fs.promises.realpath(fsPath);
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    if (!fsPath.startsWith(FS_ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const stat = await fs.promises.stat(fsPath);

    // Raw download via ?raw=1
    if (parsed.searchParams.get('raw') === '1' && stat.isFile()) {
      serveRawDownload(req, res, fsPath);
      return;
    }

    let rawUrlPath = parsed.pathname

    if (stat.isDirectory()) {
      await serveDirectory(req, res, fsPath, rawUrlPath);
    } else if (path.extname(fsPath).toLowerCase() === '.md') {
      await serveMarkdown(req, res, fsPath, rawUrlPath);
    } else if (MIME_TYPES[path.extname(fsPath).toLowerCase()]) {
      serveBinary(req, res, fsPath);
    } else {
      await serveRawText(req, res, fsPath, rawUrlPath);
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('Internal server error');
  }
}

// --- Start ---
// Listen on 0.0.0.0 (not localhost) so the server is reachable from other
// devices on the network (e.g. phone via Tailscale).
async function main() {
  await initHighlighter();
  http.createServer(handler).listen(port, '0.0.0.0', () => {
    console.log(`Serving ${FS_ROOT} at http://0.0.0.0:${port}`);
  });
}
main();
