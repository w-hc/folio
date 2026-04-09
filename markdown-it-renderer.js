const markdownIt = require('markdown-it');
const markdownItKatex = require('@traptitech/markdown-it-katex');
const markdownItAnchor = require('markdown-it-anchor');
const { highlightCode } = require('./highlight');
const { html, raw, page, breadcrumb } = require('./html-engine');

// --- markdown-it setup ---
// Unlike our hand-rolled pipeline in markdown.js, the math plugin hooks into
// markdown-it's parser and understands markdown structure — it won't match $
// inside code blocks or inline code.

let headings = [];

const md = markdownIt({
  html: true,
  highlight: (code, lang) => {
    try {
      return highlightCode(code, lang || 'python') || '';
    } catch {
      return '';  // markdown-it falls back to its own escaping
    }
  }
});

md.use(markdownItKatex, { throwOnError: false });

md.use(markdownItAnchor, {
  callback: (token, info) => {
    headings.push({ level: parseInt(token.tag[1]), text: info.title, id: info.slug });
  }
});

function renderMarkdown(text) {
  headings = [];
  const content = md.render(text);
  return { content, headings: [...headings] };
}

// --- Markdown page ---
// Dedicated page function with KaTeX CSS, TOC floating button, and overlay.

function markdownPage(title, urlPath, rendered, headings) {
  const hasToc = headings.length > 1;

  const tocList = hasToc ? html`
    <ul class="list-none p-0">
      ${headings.map(({ level, text: heading, id }) => html`
        <li style="margin-left:${String((level - 1) * 16)}px">
          <a href="${raw('#' + id)}">${heading}</a>
        </li>
      `)}
    </ul>
  ` : raw('');

  return page(
    title,
    html`
      ${breadcrumb(urlPath)}
      <article class="prose max-w-none katex-play-nice text-base">
        ${raw(rendered)}
      </article>

      ${raw(hasToc ? `
      <!-- TOC: floating button fixed to bottom-right corner -->
      <button id="toc-btn"
        class="fixed bottom-6 right-6 w-12 h-12 bg-gray-800 text-white
               rounded-full shadow-lg text-xl flex items-center justify-center
               z-50 hover:bg-gray-700 cursor-pointer">
        &#8801;
      </button>

      <!-- Dim overlay behind the TOC panel -->
      <div id="toc-overlay"
        class="fixed inset-0 bg-black/50 z-40 hidden">
      </div>

      <!-- TOC panel: slides up from the bottom -->
      <nav id="toc-panel"
        class="fixed bottom-0 left-0 right-0 max-h-[70vh] bg-white z-50
               rounded-t-2xl shadow-2xl p-6 overflow-y-auto
               translate-y-full transition-transform duration-200">
        <div class="flex justify-between items-center mb-4">
          <span class="font-bold text-lg">Contents</span>
          <button id="toc-close" class="text-2xl text-gray-400 hover:text-gray-600 cursor-pointer">
            &times;
          </button>
        </div>
      ` : '')}
      ${tocList}
      ${raw(hasToc ? `
      </nav>

      <script>
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
      </script>
      ` : '')}
    `,
    html`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">`
  );
}

module.exports = { renderMarkdown, markdownPage };
