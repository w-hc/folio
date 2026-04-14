const { Parser, Language } = require('web-tree-sitter');

let parser;
let langs = {};

async function initOutline() {
  await Parser.init();
  parser = new Parser();
  const [python, javascript] = await Promise.all([
    Language.load(require.resolve('tree-sitter-python/tree-sitter-python.wasm')),
    Language.load(require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm')),
  ]);
  langs = { python, javascript };
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

// --- JavaScript ---

function extractJSOutline(code) {
  parser.setLanguage(langs.javascript);
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

      if (child.type === 'class_declaration') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode ? nameNode.text : '?';
        const line = child.startPosition.row + 1;
        results.push({ type: 'class', name, line, depth });
        // Recurse into class body for methods
        const body = child.childForFieldName('body');
        if (body) results.push(...walk(body, depth + 1));

      } else if (child.type === 'function_declaration') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode ? nameNode.text : '?';
        const line = child.startPosition.row + 1;
        results.push({ type: 'function', name, line, depth });

      } else if (child.type === 'method_definition') {
        const nameNode = child.childForFieldName('name');
        const name = nameNode ? nameNode.text : '?';
        const line = child.startPosition.row + 1;
        results.push({ type: 'method', name, line, depth });

      } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        // const arrow = (x) => ... or const fn = function() ...
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
      }
    }
    return results;
  }

  return walk(tree.rootNode, 0);
}

// --- Dispatch ---

const EXT_TO_EXTRACTOR = {
  '.py': extractPythonOutline,
  '.js': extractJSOutline,
  '.mjs': extractJSOutline,
};

// Returns an outline for supported file types, or null if unsupported.
function extractOutline(code, ext) {
  const extractor = EXT_TO_EXTRACTOR[ext];
  return extractor ? extractor(code) : null;
}

module.exports = { initOutline, extractOutline };
