const { Parser, Language } = require('web-tree-sitter');

let parser;
let langs = {};

async function initOutline() {
  await Parser.init();
  parser = new Parser();
  const tsDir = require.resolve('tree-sitter-typescript/package.json').replace(/\/package\.json$/, '');
  const [python, javascript, typescript, tsx] = await Promise.all([
    Language.load(require.resolve('tree-sitter-python/tree-sitter-python.wasm')),
    Language.load(require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm')),
    Language.load(`${tsDir}/tree-sitter-typescript.wasm`),
    Language.load(`${tsDir}/tree-sitter-tsx.wasm`),
  ]);
  langs = { python, javascript, typescript, tsx };
}

// --- Python ---

function extractPythonOutline(code) {
  parser.setLanguage(langs.python);
  const tree = parser.parse(code);

  function walk(node, depth) {
    const results = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_definition' || child.type === 'function_definition') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode ? nameNode.text : '?';
        const line = child.startPosition.row + 1;
        const type = child.type === 'class_definition' ? 'class' : 'def';
        results.push({ type, name, line, depth });
        const body = child.childForFieldName('body');
        if (body) results.push(...walk(body, depth + 1));
      }
    }
    return results;
  }

  return walk(tree.rootNode, 0);
}

// --- JavaScript / TypeScript / JSX / TSX ---
// These share a core grammar (classes, functions, arrows). TS adds interfaces
// and type aliases; we surface those if present. Node types not in the current
// grammar just never match, so one walker handles all four languages.

function extractJSLikeOutline(code, lang) {
  parser.setLanguage(lang);
  const tree = parser.parse(code);

  function walk(node, depth) {
    const results = [];
    for (let i = 0; i < node.childCount; i++) {
      let child = node.child(i);

      // Unwrap export statements to get the actual declaration
      if (child.type === 'export_statement') {
        const decl = child.childForFieldName('declaration');
        if (decl) child = decl;
        else continue;
      }

      let type = null;
      let recurseBody = false;

      if (child.type === 'class_declaration') {
        type = 'class';
        recurseBody = true;
      } else if (child.type === 'function_declaration') {
        type = 'function';
      } else if (child.type === 'method_definition') {
        type = 'method';
      } else if (child.type === 'interface_declaration') {
        type = 'interface';
      } else if (child.type === 'type_alias_declaration') {
        type = 'type';
      } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        // const arrow = (x) => ... or const fn = function () {}
        for (let j = 0; j < child.namedChildCount; j++) {
          const declarator = child.namedChild(j);
          if (declarator.type === 'variable_declarator') {
            const value = declarator.childForFieldName('value');
            if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
              const nameNode = declarator.childForFieldName('name');
              const name = nameNode ? nameNode.text : '?';
              const line = declarator.startPosition.row + 1;
              results.push({ type: 'function', name, line, depth });
            }
          }
        }
        continue;
      } else {
        continue;
      }

      const nameNode = child.childForFieldName('name');
      const name = nameNode ? nameNode.text : '?';
      const line = child.startPosition.row + 1;
      results.push({ type, name, line, depth });

      if (recurseBody) {
        const body = child.childForFieldName('body');
        if (body) results.push(...walk(body, depth + 1));
      }
    }
    return results;
  }

  return walk(tree.rootNode, 0);
}

// --- Dispatch ---

const EXT_TO_EXTRACTOR = {
  '.py':  (code) => extractPythonOutline(code),
  '.js':  (code) => extractJSLikeOutline(code, langs.javascript),
  '.mjs': (code) => extractJSLikeOutline(code, langs.javascript),
  '.jsx': (code) => extractJSLikeOutline(code, langs.javascript),
  '.ts':  (code) => extractJSLikeOutline(code, langs.typescript),
  '.tsx': (code) => extractJSLikeOutline(code, langs.tsx),
};

// Returns an outline for supported file types, or null if unsupported.
function extractOutline(code, ext) {
  const extractor = EXT_TO_EXTRACTOR[ext];
  return extractor ? extractor(code) : null;
}

module.exports = { initOutline, extractOutline };
