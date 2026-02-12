import pool from './db';
import { logError, logInfo } from './observability';

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE
  );

  CREATE TABLE IF NOT EXISTS transcriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending',
    template VARCHAR(100),
    diarize BOOLEAN DEFAULT false,
    custom_prompt TEXT,
    auto_analyze BOOLEAN DEFAULT true,
    text TEXT,
    segments JSONB,
    speakers JSONB,
    analysis JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    mistral_api_key VARCHAR(255),
    mistral_api_key_encrypted TEXT,
    default_template VARCHAR(100) DEFAULT 'generic',
    language VARCHAR(10) DEFAULT 'de',
    context_bias TEXT,
    preferred_model VARCHAR(100) DEFAULT 'mistral-large-latest',
    default_translate_language VARCHAR(10) DEFAULT 'en',
    ocr_model VARCHAR(100) DEFAULT 'mistral-ocr-latest',
    cost_limit NUMERIC(10,2) DEFAULT NULL,
    pdf_premium_enabled_default BOOLEAN DEFAULT false,
    pdf_premium_company VARCHAR(160),
    pdf_premium_name VARCHAR(160),
    pdf_premium_role VARCHAR(160),
    pdf_premium_contact VARCHAR(255),
    pdf_premium_footer VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usage_log (

    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    model VARCHAR(100) NOT NULL,
    operation VARCHAR(50) NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost NUMERIC(10,6) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    prompt_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS text_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    prompt TEXT NOT NULL,
    is_favorite BOOLEAN DEFAULT false,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transcription_events (
    id SERIAL PRIMARY KEY,
    transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
`;

const migrations = `
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS mistral_api_key_encrypted TEXT;
  ALTER TABLE settings ALTER COLUMN default_template SET DEFAULT 'generic';
  UPDATE settings
    SET default_template = 'generic'
    WHERE default_template IS NULL
      OR btrim(default_template) = '';
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(100) DEFAULT 'mistral-large-latest';
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS cost_limit NUMERIC(10,2) DEFAULT NULL;
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_translate_language VARCHAR(10) DEFAULT 'en';
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS ocr_model VARCHAR(100) DEFAULT 'mistral-ocr-latest';
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_enabled_default BOOLEAN DEFAULT false;
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_company VARCHAR(160);
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_name VARCHAR(160);
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_role VARCHAR(160);
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_contact VARCHAR(255);
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pdf_premium_footer VARCHAR(255);
  ALTER TABLE settings ALTER COLUMN pdf_premium_enabled_default SET DEFAULT false;
  UPDATE settings
    SET pdf_premium_enabled_default = false
    WHERE pdf_premium_enabled_default IS NULL;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS auto_analyze BOOLEAN DEFAULT true;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS document_html TEXT;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS model VARCHAR(100) DEFAULT 'mistral-large-latest';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false;
  CREATE TABLE IF NOT EXISTS transcription_events (
    id SERIAL PRIMARY KEY,
    transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_transcriptions_user_id ON transcriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_user_favorite_created ON transcriptions(user_id, is_favorite DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_folder_id ON transcriptions(folder_id);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_is_favorite ON transcriptions(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_transcription_events_transcription_created ON transcription_events(transcription_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transcription_events_user_created ON transcription_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_log_user_id_created_at ON usage_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_id_user_unique ON folders(id, user_id);

  ALTER TABLE transcriptions ALTER COLUMN filename DROP NOT NULL;
  ALTER TABLE transcriptions ALTER COLUMN original_name DROP NOT NULL;
  ALTER TABLE transcriptions ALTER COLUMN file_path DROP NOT NULL;
`;

async function applyFolderOwnershipHardening(client) {
  await client.query(
    `UPDATE transcriptions t
     SET folder_id = NULL
     WHERE folder_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM folders f
         WHERE f.id = t.folder_id
           AND f.user_id = t.user_id
       )`
  );
  await client.query('ALTER TABLE transcriptions DROP CONSTRAINT IF EXISTS transcriptions_folder_id_fkey');
  await client.query('ALTER TABLE transcriptions DROP CONSTRAINT IF EXISTS fk_transcriptions_folder_owner');
  await client.query(
    `ALTER TABLE transcriptions ADD CONSTRAINT fk_transcriptions_folder_owner
     FOREIGN KEY (folder_id, user_id) REFERENCES folders(id, user_id) ON DELETE SET NULL`
  );
}

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query(migrations);
    await applyFolderOwnershipHardening(client);
    await client.query('COMMIT');
    logInfo('db_init.completed');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    logError('db_init.failed', error);
    throw error;
  } finally {
    client.release();
  }
}
