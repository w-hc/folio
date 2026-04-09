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

  // Build TOC HTML from headings.
  let toc = '';
  if (headings.length > 1) {
    toc = '<nav><ul>';
    for (const { level, text: heading, id } of headings) {
      const indent = (level - 1) * 16;
      toc += `<li style="margin-left:${indent}px"><a href="#${id}">${heading}</a></li>`;
    }
    toc += '</ul></nav>';
  }

  return { content: result, toc };
}

// --- Markdown page ---
// Dedicated page function with KaTeX CSS, TOC floating button, and overlay.

function markdownPage(title, urlPath, rendered, toc) {
  return page(
    title,
    html`
      ${breadcrumb(urlPath)}
      ${raw(toc)}
      <article class="prose max-w-none katex-play-nice text-base">
        ${raw(rendered)}
      </article>
    `,
    html`<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">`
  );
}

module.exports = { renderMarkdown, markdownPage };
