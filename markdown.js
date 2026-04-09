const { marked } = require('marked');
const { gfmHeadingId, getHeadingList } = require('marked-gfm-heading-id');
const katex = require('katex');
const { highlightCode } = require('./highlight');
const { html, raw, page, breadcrumb } = require('./html-engine');

// Adds id attributes to headings (e.g. <h2 id="setup">Setup</h2>)
// and lets us retrieve the heading list for TOC generation.
marked.use(gfmHeadingId());

// Register shiki as the code block renderer for marked.
// highlightCode is synchronous — the highlighter is initialized before
// the server starts accepting requests, so it's always ready.
marked.use({
  renderer: {
    code({ text, lang }) {
      return highlightCode(text, lang || 'python') || `<pre><code>${text}</code></pre>`;
    }
  }
});

// --- Markdown rendering ---
//
// The tricky part: markdown files can contain LaTeX math ($...$, $$...$$).
// If we pass them straight to marked, it interprets _ and * inside math as
// emphasis and mangles the LaTeX. So we:
//   1. Extract all math blocks and replace them with placeholders
//   2. Run marked on the placeholder-substituted text (safe — no math to mangle)
//   3. Replace placeholders with KaTeX-rendered HTML

function renderMarkdown(text) {
  const mathBlocks = new Map();
  let counter = 0;

  // Extract display math ($$...$$) first, then inline math ($...$).
  // Order matters — we must grab $$ before $ so "$$x$$" isn't matched as two inline $.
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const id = `%%MATH_${counter++}%%`;
    mathBlocks.set(id, { latex, displayMode: true });
    return id;
  });
  text = text.replace(/(?<!\$)\$(?!\$)(.+?)\$(?!\$)/g, (_, latex) => {
    const id = `%%MATH_${counter++}%%`;
    mathBlocks.set(id, { latex, displayMode: false });
    return id;
  });

  let result = marked(text);

  // Get heading list (populated by gfmHeadingId during the marked() call above).
  const headings = getHeadingList();

  // Replace placeholders with KaTeX HTML.
  // throwOnError: false renders malformed LaTeX as a red error message instead of crashing.
  for (const [id, { latex, displayMode }] of mathBlocks) {
    const rendered = katex.renderToString(latex, { displayMode, throwOnError: false });
    result = result.replace(id, rendered);
  }

  return { content: result, headings };
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
