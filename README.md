# Folio: a mobile-friendly file browser with Markdown and Code rendering.

Serve any directory as a browsable website. Markdown files are rendered with LaTeX math and syntax-highlighted code. Code files get syntax highlighting and a navigable outline. PDFs and images display natively. Everything else shows as plain text.

Built for one workflow: run it on your laptop, read your notes on your phone. Pair it with [Tailscale](https://tailscale.com/) to securely access your files from anywhere without exposing your laptop to the internet.

## Install

```bash
npm install -g folio-serve
```

Or clone and link locally:

```bash
git clone <repo-url>
cd folio
npm install
npm link
```

## Usage

```bash
folio /path/to/your/notes
```

Then open `http://localhost:3000` on any device on your network.

| Option | Default | Description |
|--------|---------|-------------|
| `[directory]` | `.` | Directory to serve |
| `--port PORT` | `3000` | Port number |
| `--dev` | off | Enable livereload for development |

## Features

**Directory listing** — folders first, then files with sizes. Breadcrumb navigation at the top.

**Markdown** — rendered with:
- LaTeX math (`$...$` and `$$...$$`), rendered server-side with KaTeX
- Syntax-highlighted code blocks via shiki (same grammar engine as VS Code)
- Floating outline button for navigating long documents
- Tables, links, images, and all standard Markdown features

**Code files** (`.py`, `.js`, `.rs`, `.c`, `.cc`, `.ts`, `.sh`, `.json`, `.yaml`, `.sql`, `.html`, `.css`) — syntax-highlighted, with a floating outline panel showing classes and functions.

**Everything else** — PDFs, images, and media display in the browser. Text files show as plain text. Files over 2 MB show a download button instead of rendering.

## How it works

The server is a single Node.js process using the built-in `http` module. No framework. It leverages three tools from the VS Code ecosystem:

- [**markdown-it**](https://github.com/markdown-it/markdown-it) — the same Markdown engine behind VS Code's preview, with plugins for KaTeX math and heading anchors
- [**shiki**](https://shiki.style/) — VS Code's TextMate grammars for syntax highlighting, producing inline styles server-side
- [**Tree-sitter**](https://tree-sitter.github.io/) — structural parsing for code outlines (class and function definitions)

Pages are server-rendered HTML with [Tailwind CSS](https://tailwindcss.com/) for styling. No client-side JavaScript is needed to display content — your phone receives a static HTML page. The only client JS is the outline toggle button and the optional livereload script in `--dev` mode.

## Development

For live editing of styles and templates:

```bash
npm run dev -- /path/to/notes --port 3000
```

This uses `node --watch` (Node 18+) to auto-restart the server on source file changes, and `--dev` injects a livereload script that auto-refreshes the browser after each restart.

## Security

Designed for private networks (e.g. Tailscale). No authentication or HTTPS.

Path traversal and symlink escape attacks are prevented — the server verifies that every resolved path stays within the served directory.

## License

MIT
