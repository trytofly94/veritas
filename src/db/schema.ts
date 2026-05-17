import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const archiveEntries = sqliteTable(
  "archive_entries",
  {
    id: text("id").primaryKey(),
    original_filename: text("original_filename").notNull(),
    mime_type: text("mime_type").notNull(),
    size_bytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    created_at: text("created_at").notNull(),
    label: text("label").notNull(),
    source_ip: text("source_ip").notNull(),
    tsa_provider: text("tsa_provider").notNull(),
    tsa_status: text("tsa_status").notNull(),
    tsa_attested_at: text("tsa_attested_at").notNull(),
    tsa_fallback_chain: text("tsa_fallback_chain").notNull(), // JSON-encoded array
    bundle_dir: text("bundle_dir").notNull(),
  },
  (t) => ({
    createdAtIdx: index("idx_archive_entries_created_at").on(t.created_at),
    sha256Idx: index("idx_archive_entries_sha256").on(t.sha256),
  }),
);
