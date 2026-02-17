CREATE TABLE IF NOT EXISTS wp_termmeta (
  meta_id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id INTEGER NOT NULL DEFAULT 0,
  meta_key VARCHAR(255) DEFAULT NULL,
  meta_value LONGTEXT
);

CREATE INDEX IF NOT EXISTS meta_key_index ON wp_termmeta(meta_key);
CREATE INDEX IF NOT EXISTS term_id_index ON wp_termmeta(term_id);
