// D1 share registry — the source of truth for which draft is shared at which URL.
// Schema self-creates on first use so the one-click deploy needs no migration step.

export type ShareRow = {
  share_id: string
  draft_id: string
  title: string
  content: string
  created_at: number
  // When the note itself was last edited (from the app), for an "Updated" line on
  // the share page. Null for shares created before the column / by older apps.
  note_updated_at: number | null
  // Markdown pre-rendered to HTML at share time, so `/s/:id` doesn't re-render on
  // every hit. Null for rows created before the column — the reader live-renders those.
  rendered_html: string | null
  // Word count of the note, for the share page's metadata line. Null on old rows.
  word_count: number | null
}

// Cache the "schema exists" check per isolate so we don't re-run DDL on every request.
let schemaReady = false

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS shares (
         share_id   TEXT PRIMARY KEY,
         draft_id   TEXT NOT NULL,
         title      TEXT NOT NULL,
         content    TEXT NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS shares_draft ON shares(draft_id)`),
    // Index the sort key for `GET /shares` (ORDER BY created_at DESC LIMIT …). D1
    // bills on rows *read*, so an index-backed ordered scan reads only up to the
    // LIMIT instead of the whole table — the guard against a runaway read bill.
    db.prepare(`CREATE INDEX IF NOT EXISTS shares_created ON shares(created_at)`),
  ])
  // Reconcile columns added after the table first shipped, so one-click deploys
  // (which run no migrations) self-heal. Idempotent — only adds what's missing.
  const cols = await db.prepare('PRAGMA table_info(shares)').all<{ name: string }>()
  const have = new Set(cols.results.map((r) => r.name))
  if (!have.has('note_updated_at')) {
    await db.exec('ALTER TABLE shares ADD COLUMN note_updated_at INTEGER')
  }
  if (!have.has('rendered_html')) {
    await db.exec('ALTER TABLE shares ADD COLUMN rendered_html TEXT')
  }
  if (!have.has('word_count')) {
    await db.exec('ALTER TABLE shares ADD COLUMN word_count INTEGER')
  }
  schemaReady = true
}
