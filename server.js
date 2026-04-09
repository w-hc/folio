#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { renderMarkdown, markdownPage } = require('./markdown-it-renderer');
const { initHighlighter, highlightCode, langFromExt } = require('./highlight');
const { html, raw, configure, page, breadcrumb, formatSize, UI_COLOR } = require('./html-engine');

// --- CLI args ---
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

configure({ IS_DEV });

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

async function serveMarkdown(req, res, fsPath, urlPath) {
  const content = await fs.promises.readFile(fsPath, 'utf-8');
  const name = path.basename(fsPath);
  const { content: rendered, headings } = renderMarkdown(content);
  sendHtml(res, markdownPage(name, urlPath, rendered, headings));
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

    const encodedPath = parsed.pathname;

    if (stat.isDirectory()) {
      await serveDirectory(req, res, fsPath, encodedPath);
    } else if (path.extname(fsPath).toLowerCase() === '.md') {
      await serveMarkdown(req, res, fsPath, encodedPath);
    } else if (MIME_TYPES[path.extname(fsPath).toLowerCase()]) {
      serveBinary(req, res, fsPath);
    } else {
      await serveRawText(req, res, fsPath, encodedPath);
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
