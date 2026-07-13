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

// Worker version. Bump on each meaningful change so the desktop app can detect a
// deployed worker that's behind and nudge a redeploy. Keep in sync with package.json.
const WORKER_VERSION = '0.1.0'

// Same renderer settings as the desktop app (untrusted markdown → no raw HTML).
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

// Draft ids are `draft-<uuid>`; validate before touching R2 keys (block `..`, slashes).
const DRAFT_ID = /^draft-[\w-]{1,80}$/

const DRAFT_KEY = (id: string) => `drafts/${id}.json`

// Unguessable base62 slug for a share URL.
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function newShareId(len = 16): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += BASE62[b % 62]
  return out
}

// --- Auth: bearer on sync + share-management; /s/:id and / stay public ---
// Compare with Hono's constant-time `timingSafeEqual` rather than a leaky `===`,
// so the token check can't be probed via response-timing.
const auth = bearerAuth({
  verifyToken: (token, c) => timingSafeEqual(token, (c.env as Bindings).SYNC_TOKEN),
})
app.use('/drafts', auth)
app.use('/drafts/*', auth)
app.use('/shares', auth)
app.use('/share', auth)
app.use('/share/*', auth)
app.use('/health', auth)

// --- Health / version (for the app's "Test connection" + update check) ---

// Public: lets the app read the deployed version without a token (stale-worker notice).
app.get('/version', (c) => c.json({ version: WORKER_VERSION }))

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
  const body = await c.req.text()
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
  const { draftId, title, content } = await c.req.json<{
    draftId?: string
    title?: string
    content?: string
  }>()
  if (!draftId || !DRAFT_ID.test(draftId)) return c.json({ error: 'bad draftId' }, 400)
  if (typeof content !== 'string') return c.json({ error: 'bad content' }, 400)
  const shareId = newShareId()
  const now = Date.now()
  await c.env.SHARES.batch([
    c.env.SHARES.prepare('DELETE FROM shares WHERE draft_id = ?').bind(draftId),
    c.env.SHARES.prepare(
      'INSERT INTO shares (share_id, draft_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(shareId, draftId, title ?? '', content, now),
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
  const row = await c.env.SHARES.prepare('SELECT title, content FROM shares WHERE share_id = ?')
    .bind(c.req.param('id'))
    .first<{ title: string; content: string }>()
  if (!row) return c.html(<NotFoundPage />, 404)
  const bodyHtml = md.render(row.content)
  c.header('Cache-Control', 'public, max-age=300')
  return c.html(<SharePage title={row.title || 'Shared note'} bodyHtml={bodyHtml} />)
})

app.get('/', (c) => c.html(<Landing />))

export default app
