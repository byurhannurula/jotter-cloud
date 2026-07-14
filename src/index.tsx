import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { timingSafeEqual } from 'hono/utils/buffer'
import MarkdownIt from 'markdown-it'
import { ensureSchema } from './db'
import { Landing, NotFoundPage, SharePage } from './ui'

type Bindings = {
  DRAFTS: R2Bucket
  SHARES: D1Database
  SYNC_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()

// Baseline hardening headers on every response; a strict CSP is added only on the
// HTML pages (the only responses a browser renders). Markdown is rendered with
// `html:false` upstream, so the CSP is defense-in-depth. `style-src 'unsafe-inline'`
// covers the page's inline <style>; `img-src https: data:` covers avatars and any
// image embedded in a shared note.
const CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  if ((c.res.headers.get('content-type') ?? '').includes('text/html'))
    c.header('Content-Security-Policy', CSP)
})

// Worker version. Bump on each meaningful change so the desktop app can detect a
// deployed worker that's behind and nudge a redeploy. Keep in sync with package.json.
const WORKER_VERSION = '0.1.2'

// Same renderer settings as the desktop app (untrusted markdown → no raw HTML).
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

// Draft ids are `draft-<uuid>`; validate before touching R2 keys (block `..`, slashes).
const DRAFT_ID = /^draft-[\w-]{1,80}$/

const DRAFT_KEY = (id: string) => `drafts/${id}.json`

// Body-size caps so a leaked token can't grow R2/D1 without bound. Draft bodies
// live in R2; a share's `content` lands in a single D1 row (~1 MB ceiling), so it
// is capped tighter to fail with a clean 413 instead of a backend 500.
const MAX_DRAFT_BYTES = 1024 * 1024 // 1 MB per draft object
const MAX_SHARE_BYTES = 512 * 1024 // 512 KB of note content per share
const SHARE_REQUEST_SLACK = 64 * 1024 // headroom for title + JSON framing around content

const byteLength = (s: string): number => new TextEncoder().encode(s).length

// Reject an oversized request from its declared Content-Length before we buffer it.
// (Chunked requests omit it, so callers still re-check the actual body length.)
const declaredOver = (header: string | undefined, max: number): boolean => {
  const len = Number(header)
  return Number.isFinite(len) && len > max
}

// Minimum length we accept for SYNC_TOKEN. Jotter's "Generate token" makes a long
// random one; this only rejects blank/obviously-weak secrets so the worker fails
// closed rather than running an unauthenticated store.
const MIN_TOKEN_LEN = 16

// True only when a usable SYNC_TOKEN secret is actually set on the worker.
const hasValidToken = (env: Bindings): boolean =>
  typeof env.SYNC_TOKEN === 'string' && env.SYNC_TOKEN.length >= MIN_TOKEN_LEN

// Unguessable base62 slug for a share URL. Rejection-sample so every character is
// uniformly distributed: a raw byte is 0-255, and 256 isn't a multiple of 62, so
// `b % 62` would bias the first `256 % 62` values. Dropping bytes >= 248 (4*62)
// removes that bias. ~16 chars ≈ 95 bits either way; this just makes it exact.
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function newShareId(len = 16): string {
  let out = ''
  while (out.length < len) {
    const bytes = new Uint8Array(len)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b >= 248) continue // biased tail — resample
      out += BASE62[b % 62]
      if (out.length === len) break
    }
  }
  return out
}

// --- Auth: bearer on sync + share-management; /s/:id and / stay public ---
// Fail closed if the secret is missing/weak, so a deploy that skipped the token
// prompt can't become an open notes store. Otherwise compare with Hono's
// constant-time `timingSafeEqual` rather than a leaky `===`, so the token check
// can't be probed via response-timing.
const auth = bearerAuth({
  verifyToken: (token, c) => {
    const env = c.env as Bindings
    if (!hasValidToken(env)) return false
    return timingSafeEqual(token, env.SYNC_TOKEN)
  },
})
app.use('/drafts', auth)
app.use('/drafts/*', auth)
app.use('/shares', auth)
app.use('/share', auth)
app.use('/share/*', auth)
app.use('/health', auth)

// --- Health / version (for the app's "Test connection" + update check) ---

// Public: lets the app read the deployed version without a token (stale-worker notice).
// `configured: false` means no usable SYNC_TOKEN is set yet — every sync route fails
// closed until one is — so the app's setup can show a clear "set your token" hint
// instead of an ambiguous 401.
app.get('/version', (c) => c.json({ version: WORKER_VERSION, configured: hasValidToken(c.env) }))

// Token-guarded connection check. 401 = bad token, 200 = URL + token + D1 all good,
// 500 = token fine but the backend is broken. Warms/provisions the D1 schema too.
app.get('/health', async (c) => {
  try {
    await ensureSchema(c.env.SHARES)
    return c.json({ ok: true, version: WORKER_VERSION })
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// --- Sync: R2 drafts store ---

// List every object's delta metadata (id + updatedAt + deleted) for the pull pass.
app.get('/drafts', async (c) => {
  const drafts: { id: string; updatedAt: number; deleted: boolean }[] = []
  let cursor: string | undefined
  do {
    const page = await c.env.DRAFTS.list({
      prefix: 'drafts/',
      include: ['customMetadata'],
      cursor,
    })
    for (const o of page.objects) {
      const id = o.key.slice('drafts/'.length).replace(/\.json$/, '')
      const meta = o.customMetadata ?? {}
      drafts.push({
        id,
        updatedAt: Number(meta.updatedAt ?? 0),
        deleted: meta.deleted === '1',
      })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return c.json({ drafts })
})

// Fetch one draft's JSON body (404 for missing or tombstoned).
app.get('/drafts/:id', async (c) => {
  const id = c.req.param('id')
  if (!DRAFT_ID.test(id)) return c.json({ error: 'bad id' }, 400)
  const obj = await c.env.DRAFTS.get(DRAFT_KEY(id))
  if (!obj || obj.customMetadata?.deleted === '1') return c.json({ error: 'not found' }, 404)
  return new Response(obj.body, { headers: { 'content-type': 'application/json' } })
})

// Upsert a draft; stamp updatedAt from the body so listing can delta cheaply.
app.put('/drafts/:id', async (c) => {
  const id = c.req.param('id')
  if (!DRAFT_ID.test(id)) return c.json({ error: 'bad id' }, 400)
  if (declaredOver(c.req.header('content-length'), MAX_DRAFT_BYTES))
    return c.json({ error: 'draft too large' }, 413)
  const body = await c.req.text()
  if (byteLength(body) > MAX_DRAFT_BYTES) return c.json({ error: 'draft too large' }, 413)
  let updatedAt = Date.now()
  try {
    const parsed = JSON.parse(body) as { updated_at?: number }
    if (typeof parsed.updated_at === 'number') updatedAt = parsed.updated_at
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  await c.env.DRAFTS.put(DRAFT_KEY(id), body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { updatedAt: String(updatedAt) },
  })
  return c.json({ ok: true, updatedAt })
})

// Tombstone a draft so other devices learn of the deletion.
app.delete('/drafts/:id', async (c) => {
  const id = c.req.param('id')
  if (!DRAFT_ID.test(id)) return c.json({ error: 'bad id' }, 400)
  const now = Date.now()
  await c.env.DRAFTS.put(DRAFT_KEY(id), '', {
    customMetadata: { updatedAt: String(now), deleted: '1' },
  })
  return c.json({ ok: true, updatedAt: now })
})

// --- Sharing: D1 registry (source of truth for URLs) ---

// Create/replace a draft's share. Upsert by draft_id so one draft has one live URL.
app.post('/share', async (c) => {
  await ensureSchema(c.env.SHARES)
  if (declaredOver(c.req.header('content-length'), MAX_SHARE_BYTES + SHARE_REQUEST_SLACK))
    return c.json({ error: 'share too large' }, 413)
  const { draftId, title, content, updatedAt } = await c.req.json<{
    draftId?: string
    title?: string
    content?: string
    updatedAt?: number
  }>()
  if (!draftId || !DRAFT_ID.test(draftId)) return c.json({ error: 'bad draftId' }, 400)
  if (typeof content !== 'string') return c.json({ error: 'bad content' }, 400)
  if (byteLength(content) > MAX_SHARE_BYTES) return c.json({ error: 'content too large' }, 413)
  // Optional: when the note was last edited, for the share page's "Updated" line.
  const noteUpdatedAt = typeof updatedAt === 'number' ? updatedAt : null
  const shareId = newShareId()
  const now = Date.now()
  await c.env.SHARES.batch([
    c.env.SHARES.prepare('DELETE FROM shares WHERE draft_id = ?').bind(draftId),
    c.env.SHARES.prepare(
      'INSERT INTO shares (share_id, draft_id, title, content, created_at, note_updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(shareId, draftId, title ?? '', content, now, noteUpdatedAt),
  ])
  const url = `${new URL(c.req.url).origin}/s/${shareId}`
  return c.json({ shareId, url })
})

// List all live shares — the app's local cache source.
app.get('/shares', async (c) => {
  await ensureSchema(c.env.SHARES)
  const { results } = await c.env.SHARES.prepare(
    'SELECT share_id, draft_id, created_at FROM shares ORDER BY created_at DESC',
  ).all<{ share_id: string; draft_id: string; created_at: number }>()
  const origin = new URL(c.req.url).origin
  return c.json({
    shares: results.map((r) => ({
      draftId: r.draft_id,
      shareId: r.share_id,
      url: `${origin}/s/${r.share_id}`,
      createdAt: r.created_at,
    })),
  })
})

// Revoke — delete the row so /s/:id immediately 404s.
app.delete('/share/:id', async (c) => {
  await ensureSchema(c.env.SHARES)
  await c.env.SHARES.prepare('DELETE FROM shares WHERE share_id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// --- Public pages ---

// Render a shared note (or a 404 page if revoked/unknown).
app.get('/s/:id', async (c) => {
  await ensureSchema(c.env.SHARES)
  const row = await c.env.SHARES.prepare(
    'SELECT title, content, note_updated_at FROM shares WHERE share_id = ?',
  )
    .bind(c.req.param('id'))
    .first<{ title: string; content: string; note_updated_at: number | null }>()
  if (!row) return c.html(<NotFoundPage />, 404)
  const bodyHtml = md.render(row.content)
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(
    <SharePage
      title={row.title || 'Shared note'}
      bodyHtml={bodyHtml}
      updatedAt={row.note_updated_at ?? undefined}
    />,
  )
})

app.get('/', (c) => c.html(<Landing />))

export default app
