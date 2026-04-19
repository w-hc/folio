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
    return html` / <a class="${UI_COLOR} hover:underline mx-1 " href="${raw(hrefSoFar)}">${decodeURIComponent(seg)}</a>`;
  });
  return html`
    <div class="mb-4 p-1 sticky top-0 bg-white shadow-sm">
      <a class="${UI_COLOR} hover:underline mr-1" href="/">root</a>
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

// Format a Date as YY_MMDD_HHMM_SS (e.g. 26_0418_2024_14)
function formatMtime(date) {
  const p = (n) => String(n).padStart(2, '0');
  const yy = p(date.getFullYear() % 100);
  const mm = p(date.getMonth() + 1);
  const dd = p(date.getDate());
  const hh = p(date.getHours());
  const mi = p(date.getMinutes());
  const ss = p(date.getSeconds());
  return `${yy}_${mm}${dd}_${hh}${mi}_${ss}`;
}

// Minimal CSS for things Tailwind can't handle.
const CSS = `
.katex { font-size: 1.1em !important; }
.katex-display { margin: 0.05rem 0 !important; overflow-x: auto; overflow-y: hidden; }
.katex-play-nice .katex { font-weight: inherit; font-style: inherit; text-decoration: inherit; color: inherit; }
/* Tailwind's prose inserts visual backticks around <code> via CSS pseudo-elements.
   Turn that off — we want styled code, not Markdown-style backtick decoration. */
.prose code::before, .prose code::after { content: none; }
/* Only style inline code, not code inside <pre> (shiki code blocks) */
.prose :not(pre) > code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-weight: normal; }
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
<body class="max-w-5xl mx-auto px-4">
  ${body}
</body>
</html>`[RAW];
}  // px- needed for phone viewing

// Floating panel with a button in the bottom-right corner.
// Used for markdown TOC and code outline. Pass the list content as html``.
// Returns empty if listContent is falsy.
function floatingPanel(listContent) {
  if (!listContent) return raw('');
  return html`
    <button id="toc-btn"
      class="fixed bottom-6 right-6 w-12 h-12 bg-gray-800 text-white
             rounded-full shadow-lg text-xl flex items-center justify-center
             z-50 hover:bg-gray-700 cursor-pointer">
      &#8801;
    </button>

    <div id="toc-overlay"
      class="fixed inset-0 bg-black/50 z-40 hidden">
    </div>

    <nav id="toc-panel"
      class="fixed bottom-0 left-0 right-0 max-h-[70vh] bg-white z-50
             rounded-t-2xl shadow-2xl p-6 overflow-y-auto
             translate-y-full transition-transform duration-200">
      <div class="flex justify-between items-center mb-4">
        <span class="font-bold text-lg">Outline</span>
        <button id="toc-close"
          class="text-2xl text-gray-400 hover:text-gray-600 cursor-pointer">
          &times;
        </button>
      </div>
      ${listContent}
    </nav>

    ${raw(`<script>
      (function() {
        var btn = document.getElementById('toc-btn');
        var overlay = document.getElementById('toc-overlay');
        var panel = document.getElementById('toc-panel');
        var close = document.getElementById('toc-close');

        function open() {
          overlay.classList.remove('hidden');
          panel.classList.remove('translate-y-full');
        }
        function shut() {
          overlay.classList.add('hidden');
          panel.classList.add('translate-y-full');
        }

        btn.addEventListener('click', open);
        overlay.addEventListener('click', shut);
        close.addEventListener('click', shut);

        panel.querySelectorAll('a').forEach(function(a) {
          a.addEventListener('click', shut);
        });
      })();
    </script>`)}
  `;
}

module.exports = {
  html, raw, toHtml,
  configure, page, breadcrumb, formatSize, formatMtime, floatingPanel,
  UI_COLOR,
};
