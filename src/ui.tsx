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
  .wrap { max-width: 44rem; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
  .share-head {
    display: flex; gap: 0.85rem; align-items: center; flex-wrap: wrap;
    margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border);
  }
  .avatar {
    width: 40px; height: 40px; border-radius: 50%;
    flex-shrink: 0; object-fit: cover; background: var(--code-bg);
  }
  .head-text { min-width: 0; flex: 1 1 12rem; }
  .doc-title {
    font-size: 1.5rem; font-weight: 600; line-height: 1.25;
    margin: 0 0 0.2rem; overflow-wrap: break-word;
  }
  .meta { margin: 0; color: var(--muted); font-size: 0.85rem; }
  .actions { display: flex; gap: 0.4rem; margin-left: auto; flex-shrink: 0; }
  .btn {
    font: inherit; font-size: 0.82rem; line-height: 1; white-space: nowrap;
    color: var(--fg); background: var(--code-bg);
    border: 1px solid var(--border); border-radius: 7px;
    padding: 0.4rem 0.7rem; cursor: pointer; text-decoration: none;
  }
  .btn:hover { border-color: var(--muted); }
  .btn:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  .toast {
    position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%);
    background: var(--fg); color: var(--bg);
    padding: 0.5rem 0.9rem; border-radius: 999px; font-size: 0.85rem;
    opacity: 0; transition: opacity 0.25s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
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

// Inline "J" mark as a data-URI favicon — no binary asset to serve from the Worker.
// Governed by CSP `img-src data:`, which is already allowed.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0a84ff"/><text x="16" y="23" font-family="-apple-system,system-ui,sans-serif" font-size="21" font-weight="700" fill="#fff" text-anchor="middle">J</text></svg>`
const FAVICON = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

export const BaseLayout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <link rel="icon" href={FAVICON} />
      <title>{title}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      <div class="wrap">{children}</div>
    </body>
  </html>
)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A short, locale-independent date (Workers' Intl data is limited). e.g. "14 Jul 2026".
function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// "just now" / "5 min ago" / "3 hours ago" / "2 days ago", else an absolute date.
function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const units: [number, string][] = [
    [3600, 'min'],
    [86400, 'hour'],
    [2592000, 'day'],
  ]
  for (let i = 0; i < units.length; i++) {
    const [limit, name] = units[i]
    if (s < limit) {
      const div = i === 0 ? 60 : units[i - 1][0]
      const n = Math.floor(s / div)
      return `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return `on ${fmtDate(ms)}`
}

// Human byte size for the metadata line. e.g. "812 B", "1.4 KB", "2.0 MB".
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Thousands separators without relying on Intl (limited in Workers). e.g. "1,234".
function fmtCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const readingTime = (words: number): number => Math.max(1, Math.ceil(words / 200))

// Clipboard actions for the share page. Uses `location` so no server data is injected
// into the script; the raw source is fetched from the sibling /raw path on demand.
const SHARE_SCRIPT = `
(function () {
  var toastEl = document.getElementById('toast');
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }
  var link = document.getElementById('copy-link');
  if (link) link.addEventListener('click', function () {
    navigator.clipboard.writeText(location.href).then(
      function () { toast('Link copied'); },
      function () { toast('Copy failed'); }
    );
  });
  var md = document.getElementById('copy-md');
  if (md) md.addEventListener('click', function () {
    fetch(location.pathname + '/raw')
      .then(function (r) { return r.text(); })
      .then(function (t) { return navigator.clipboard.writeText(t); })
      .then(function () { toast('Markdown copied'); }, function () { toast('Copy failed'); });
  });
})();
`

type SharePageProps = {
  title: string
  bodyHtml: string
  rawPath: string
  authorName?: string
  authorAvatar?: string
  wordCount?: number
  sizeBytes: number
  createdAt: number
  updatedAt?: number
}

// A rendered note (markdown-it → HTML, html:false upstream) with an identity header,
// a metadata line, and a clean reading column. Author name/avatar are optional and
// the header degrades gracefully to just the title + metadata when they're unset.
export const SharePage: FC<SharePageProps> = ({
  title,
  bodyHtml,
  rawPath,
  authorName,
  authorAvatar,
  wordCount,
  sizeBytes,
  createdAt,
  updatedAt,
}) => {
  const meta = [
    authorName?.trim() || null,
    wordCount ? `${fmtCount(wordCount)} words` : null,
    wordCount ? `${readingTime(wordCount)} min read` : null,
    fmtBytes(sizeBytes),
    `shared ${timeAgo(createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <BaseLayout title={`${title} — Jotter`}>
      <header class="share-head">
        {authorAvatar ? <img class="avatar" src={authorAvatar} alt="" /> : null}
        <div class="head-text">
          <h1 class="doc-title">{title}</h1>
          <p class="meta">{meta}</p>
        </div>
        <div class="actions">
          <button type="button" class="btn" id="copy-link">
            Copy link
          </button>
          <button type="button" class="btn" id="copy-md">
            Copy markdown
          </button>
          <a class="btn" href={rawPath}>
            View raw
          </a>
        </div>
      </header>
      <main class="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
      <footer class="footer">
        {updatedAt ? `Updated ${fmtDate(updatedAt)} · ` : ''}shared from Jotter
      </footer>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
      <script dangerouslySetInnerHTML={{ __html: SHARE_SCRIPT }} />
    </BaseLayout>
  )
}

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
