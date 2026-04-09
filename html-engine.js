// --- HTML tagged template engine ---
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

// Unwrap a raw()-wrapped value to a plain string. Used by page functions
// as the final step before sending to the HTTP response.
function toHtml(rawVal) {
  return rawVal[RAW];
}

// --- Page helpers ---

const UI_COLOR = 'text-indigo-500';

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

// Minimal CSS for things Tailwind can't handle.
const CSS = `
.katex { font-size: 1.1em !important; }
.katex-display { margin: 0.05rem 0 !important; overflow-x: auto; overflow-y: hidden; }
.katex-play-nice .katex { font-weight: inherit; font-style: inherit; text-decoration: inherit; color: inherit; }
article table { border-collapse: collapse; width: 100%; overflow-x: auto; display: block; }
article th, article td { border: 1px solid #ddd; padding: 8px; text-align: left; }
article th { background: #f6f8fa; }`;

// Set once at startup by server.js via configure().
let IS_DEV = false;

function configure(opts) {
  IS_DEV = opts.IS_DEV || false;
}

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

module.exports = {
  html, raw, toHtml,
  configure, page, breadcrumb, formatSize,
  UI_COLOR,
};
