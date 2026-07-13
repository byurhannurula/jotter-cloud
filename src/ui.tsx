// JSX UI for the worker's public pages: the shared-note reader, a small landing page,
// and a 404 for revoked/unknown links. Rendered with `c.html(<Page/>)` in index.tsx.
import type { FC, PropsWithChildren } from 'hono/jsx'

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1c1c1e;
    --muted: #8a8a8e;
    --border: #e5e5ea;
    --link: #0a84ff;
    --code-bg: #f4f4f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1c1c1e;
      --fg: #e8e8ea;
      --muted: #8a8a8e;
      --border: #2c2c2e;
      --link: #4aa3ff;
      --code-bg: #2a2a2c;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 44rem; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
  .prose { overflow-wrap: break-word; }
  .prose h1, .prose h2, .prose h3 { line-height: 1.25; margin: 1.8em 0 0.6em; }
  .prose h1 { font-size: 1.9rem; }
  .prose h2 { font-size: 1.45rem; }
  .prose h3 { font-size: 1.2rem; }
  .prose p { margin: 0.9em 0; }
  .prose a { color: var(--link); }
  .prose ul, .prose ol { padding-left: 1.4em; }
  .prose blockquote {
    margin: 1em 0; padding: 0.2em 1em;
    border-left: 3px solid var(--border); color: var(--muted);
  }
  .prose pre {
    background: var(--code-bg); padding: 1em; border-radius: 8px;
    overflow-x: auto; font-size: 0.9em;
  }
  .prose code {
    background: var(--code-bg); padding: 0.15em 0.35em;
    border-radius: 4px; font-size: 0.9em;
  }
  .prose pre code { background: none; padding: 0; }
  .prose img { max-width: 100%; height: auto; }
  .prose hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
  .prose table { border-collapse: collapse; }
  .prose th, .prose td { border: 1px solid var(--border); padding: 0.4em 0.7em; }
  .footer {
    margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
    color: var(--muted); font-size: 0.85rem;
  }
  .footer a { color: var(--muted); }
  .center { text-align: center; }
  .lead { color: var(--muted); font-size: 1.05rem; }
`

export const BaseLayout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <div class="wrap">{children}</div>
    </body>
  </html>
)

// A rendered note (markdown-it → HTML, html:false upstream) in a clean reading column.
export const SharePage: FC<{ title: string; bodyHtml: string }> = ({ title, bodyHtml }) => (
  <BaseLayout title={title}>
    <main class="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
    <footer class="footer">shared from Jotter</footer>
  </BaseLayout>
)

export const Landing: FC = () => (
  <BaseLayout title="Jotter sync worker">
    <main class="center">
      <h1>Jotter</h1>
      <p class="lead">This is a Jotter sync worker.</p>
      <p class="lead">
        It privately backs up and shares notes for one person. There's nothing to see here.
      </p>
      <p class="footer center">
        <a href="https://github.com/byurhannurula/jotter">github.com/byurhannurula/jotter</a>
      </p>
    </main>
  </BaseLayout>
)

export const NotFoundPage: FC = () => (
  <BaseLayout title="Not found">
    <main class="center">
      <h1>Not found</h1>
      <p class="lead">This link is no longer available. It may have been revoked.</p>
    </main>
  </BaseLayout>
)
