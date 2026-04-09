const { createHighlighter } = require('shiki');

// Shiki loads TextMate grammars (same as VS Code) and must be initialized async.
// We preload languages at startup so highlightCode can be called synchronously.
const PRELOADED_LANGS = [
  'python', 'javascript', 'typescript', 'c', 'cpp', 'bash', 'rust',
  'json', 'yaml', 'toml', 'sql', 'text',
];

let highlighter;
async function initHighlighter() {
  highlighter = await createHighlighter({
    themes: ['one-light'],
    langs: PRELOADED_LANGS,
  });
}

// Map file extensions to shiki language names.
const EXT_TO_LANG = {
  '.py': 'python',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.ts': 'typescript',
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
};

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
