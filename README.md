# Folio: a mobile-friendly file browser with Markdown rendering.

Serve any directory as a browsable website. Markdown files are rendered with LaTeX math and syntax-highlighted code. Everything else is viewable too — code files get syntax highlighting, PDFs and images display natively, and all other files show as plain text.

Built for one workflow: run it on your laptop, read your notes on your phone. Pair it with [Tailscale](https://tailscale.com/) to securely access your files from anywhere without exposing your laptop to the internet.

## Install

```bash
git clone <repo-url>
cd noteserve
npm install
```

## Usage

```bash
node server.js /path/to/your/notes
```

Then open `http://localhost:3000` on any device on your network.

| Option | Default | Description |
|--------|---------|-------------|
| `[directory]` | `.` | Directory to serve |
| `--port PORT` | `3000` | Port number |
| `--dev` | off | Enable livereload for development |

## What it looks like

**Directory listing** — folders first, then files with sizes. Breadcrumb navigation at the top.

**Markdown** — rendered with:
- LaTeX math (`$...$` and `$$...$$`), rendered server-side with KaTeX
- Syntax-highlighted code blocks via shiki (same grammar engine as VS Code)
- Floating table of contents button for long documents
- Tables, links, images, and all standard Markdown features

**Code files** (`.py`, `.js`, `.rs`, `.c`, etc.) — syntax-highlighted.

**Everything else** — PDFs, images, and media display in the browser. Text files show as plain text. Files over 2 MB show a download button instead of rendering.

## How it works

The server is a single Node.js process using the built-in `http` module. No framework.

Markdown rendering uses [markdown-it](https://github.com/markdown-it/markdown-it) (the same engine behind VS Code's Markdown preview) with plugins for math ([KaTeX](https://katex.org/)) and heading anchors. The math plugin understands Markdown structure, so `$` inside code blocks and inline code is handled correctly.

Syntax highlighting uses [shiki](https://shiki.style/), which runs VS Code's TextMate grammars server-side and produces inline styles — no client-side stylesheet needed.

Styling uses [Tailwind CSS](https://tailwindcss.com/) via CDN.

Pages are server-rendered HTML. No client-side JavaScript is needed to display content — your phone just receives a static HTML page. The only client JS is the TOC toggle button on Markdown pages, and the optional livereload script in `--dev` mode.

## Development

For live editing of styles and templates:

```bash
node --watch server.js /path/to/notes --dev
```

`node --watch` (Node 18+) restarts the server on source file changes. `--dev` injects a livereload script that auto-refreshes the browser after restart.

## Security

Designed for private networks (e.g. Tailscale). No authentication or HTTPS.

Path traversal and symlink escape attacks are prevented — the server verifies that every resolved path stays within the served directory.

## License

MIT
