const { marked } = require('marked');
const { createHighlighter } = require('shiki');
const katex = require('katex');

// --- Shiki setup ---
// Shiki loads TextMate grammars (same as VS Code) and must be initialized async.
// We preload languages at startup so the marked renderer can call codeToHtml
// synchronously — no need for the broken loadLanguageSync.
const PRELOADED_LANGS = [
  'python', 'javascript', 'c', 'cpp', 'bash', 'rust',
  'json', 'yaml', 'sql', 'text',
];

let highlighter;
async function initHighlighter() {
  highlighter = await createHighlighter({
    themes: ['one-light'],
    langs: PRELOADED_LANGS,
  });

  // Register renderer after highlighter is ready.
  // Shiki returns fully styled HTML (inline styles), so no external CSS is needed.
  marked.use({
    renderer: {
      code({ text, lang }) {
        try {
          return highlighter.codeToHtml(text, { lang: lang || 'python', theme: 'one-light' });
        } catch {
          // Language not preloaded — fall back to plain <pre> block
          return `<pre><code>${text}</code></pre>`;
        }
      }
    }
  });
}

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

  // Replace placeholders with KaTeX HTML.
  // throwOnError: false renders malformed LaTeX as a red error message instead of crashing.
  for (const [id, { latex, displayMode }] of mathBlocks) {
    const rendered = katex.renderToString(latex, { displayMode, throwOnError: false });
    result = result.replace(id, rendered);
  }

  return result;
}

module.exports = { initHighlighter, renderMarkdown };
