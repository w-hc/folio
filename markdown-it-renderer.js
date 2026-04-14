const markdownIt = require('markdown-it');
const markdownItKatex = require('@traptitech/markdown-it-katex');
const markdownItAnchor = require('markdown-it-anchor');
const { highlightCode } = require('./highlight');
const { html, raw, page, breadcrumb, floatingPanel } = require('./html-engine');

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
    <ul class="list-none p-0 overflow-x-auto">
      ${headings.map(({ level, text: heading, id }) => html`
        <li style="margin-left:${String((level - 1) * 16)}px">
          <a href="${raw('#' + id)}" class="whitespace-nowrap">${heading}</a>
        </li>
      `)}
    </ul>
  ` : null;

  return page(
    title,
    html`
      ${breadcrumb(urlPath)}
      <article class="prose max-w-none katex-play-nice text-base">
        ${raw(rendered)}
      </article>
      ${floatingPanel(tocList)}
    `,
    html`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">`
  );
}

module.exports = { renderMarkdown, markdownPage };
