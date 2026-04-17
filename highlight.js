const { createHighlighter } = require('shiki');

// Map file extensions to shiki language names.
// This is the single source of truth — preloaded languages are derived from it.
const EXT_TO_LANG = {
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.rs': 'rust',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.json': 'json',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.yml': 'yaml',
  '.sql': 'sql',
  '.html': 'html',
  '.css': 'css',
};

// Deduplicate language names from EXT_TO_LANG, plus 'text' as a fallback.
const PRELOADED_LANGS = [...new Set(Object.values(EXT_TO_LANG)), 'text'];

let highlighter;
async function initHighlighter() {
  highlighter = await createHighlighter({
    themes: ['one-light'],
    langs: PRELOADED_LANGS,
  });
}

// Highlight code as the given language. Returns styled HTML string,
// or null if the language isn't recognized.
function highlightCode(code, lang) {
  if (!lang) return null;
  try {
    return highlighter.codeToHtml(code, { lang, theme: 'one-light' });
  } catch {
    return null;
  }
}

// Look up the shiki language name for a file extension (e.g. '.py' → 'python').
function langFromExt(ext) {
  return EXT_TO_LANG[ext] || null;
}

module.exports = { initHighlighter, highlightCode, langFromExt };
