CREATE TABLE IF NOT EXISTS archive_entries (
  id TEXT PRIMARY KEY NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  label TEXT NOT NULL,
  source_ip TEXT NOT NULL,
  tsa_provider TEXT NOT NULL,
  tsa_status TEXT NOT NULL,
  tsa_attested_at TEXT NOT NULL,
  tsa_fallback_chain TEXT NOT NULL,
  bundle_dir TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archive_entries_created_at ON archive_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_entries_sha256 ON archive_entries(sha256);
