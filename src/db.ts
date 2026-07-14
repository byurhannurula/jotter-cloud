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
  ])
  // Reconcile columns added after the table first shipped, so one-click deploys
  // (which run no migrations) self-heal. Idempotent — only adds what's missing.
  const cols = await db.prepare('PRAGMA table_info(shares)').all<{ name: string }>()
  const have = new Set(cols.results.map((r) => r.name))
  if (!have.has('note_updated_at')) {
    await db.exec('ALTER TABLE shares ADD COLUMN note_updated_at INTEGER')
  }
  schemaReady = true
}
