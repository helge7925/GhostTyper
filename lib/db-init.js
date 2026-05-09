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

  CREATE TABLE IF NOT EXISTS template_categories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#f97316',
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    prompt_text TEXT NOT NULL,
    category_id INTEGER REFERENCES template_categories(id) ON DELETE SET NULL,
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

  CREATE TABLE IF NOT EXISTS transcription_events (
    id SERIAL PRIMARY KEY,
    transcription_id INTEGER REFERENCES transcriptions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    stage VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    meta JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(80),
    target_id VARCHAR(160),
    severity VARCHAR(20) DEFAULT 'info',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enterprise_settings (
    key VARCHAR(120) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS member_monthly_budget_limit NUMERIC(10,2) DEFAULT NULL;
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
  CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users((lower(email)));
  CREATE TABLE IF NOT EXISTS oidc_account_bindings (
    provider VARCHAR(80) NOT NULL,
    provider_account_id VARCHAR(255) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, provider_account_id)
  );
  CREATE INDEX IF NOT EXISTS idx_oidc_account_bindings_user_id
    ON oidc_account_bindings(user_id);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_user_favorite_created ON transcriptions(user_id, is_favorite DESC, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_folder_id ON transcriptions(folder_id);
  CREATE INDEX IF NOT EXISTS idx_transcriptions_is_favorite ON transcriptions(is_favorite);
  CREATE INDEX IF NOT EXISTS idx_transcription_events_transcription_created ON transcription_events(transcription_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_transcription_events_user_created ON transcription_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_log_user_id_created_at ON usage_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
  CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_id_user_unique ON folders(id, user_id);

  -- Table template support
  ALTER TABLE templates ADD COLUMN IF NOT EXISTS template_type VARCHAR(20) DEFAULT 'text' CHECK (template_type IN ('text', 'table'));
  ALTER TABLE templates ADD COLUMN IF NOT EXISTS table_schema JSONB DEFAULT NULL;
  CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(template_type);

  -- Analysis type for table results
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS analysis_type VARCHAR(20) DEFAULT 'text' CHECK (analysis_type IN ('text', 'table'));
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS table_schema JSONB DEFAULT NULL;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS analysis_meta JSONB DEFAULT NULL;

  ALTER TABLE transcriptions ALTER COLUMN filename DROP NOT NULL;
  ALTER TABLE transcriptions ALTER COLUMN original_name DROP NOT NULL;
  ALTER TABLE transcriptions ALTER COLUMN file_path DROP NOT NULL;

  -- Template categories
  CREATE TABLE IF NOT EXISTS template_categories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#f97316',
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_template_categories_user_id ON template_categories(user_id);

  ALTER TABLE templates ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES template_categories(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_templates_category_id ON templates(category_id);

  -- Audit log
  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(120) NOT NULL,
    target_type VARCHAR(80),
    target_id VARCHAR(160),
    severity VARCHAR(20) DEFAULT 'info',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log(action, created_at DESC);

  CREATE TABLE IF NOT EXISTS enterprise_settings (
    key VARCHAR(120) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  -- ===========================================================================
  -- Phase 4a — Workspace / Organisation layer (additive, NULLABLE column on
  -- existing tables). Backfilled by scripts/migrate-to-organizations.mjs;
  -- the NOT NULL flip happens in Phase 4b once API endpoints are migrated.
  -- ===========================================================================
  CREATE TABLE IF NOT EXISTS organizations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    slug VARCHAR(80) UNIQUE NOT NULL,
    plan VARCHAR(40) NOT NULL DEFAULT 'free',
    is_personal BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organization_members (
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(40) NOT NULL DEFAULT 'member',
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

  CREATE TABLE IF NOT EXISTS organization_invites (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(40) NOT NULL DEFAULT 'member',
    token VARCHAR(120) UNIQUE NOT NULL,
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_org_invites_org ON organization_invites(organization_id);

  CREATE TABLE IF NOT EXISTS organization_settings (
    organization_id BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    default_language VARCHAR(10),
    retention_days INTEGER,
    cost_limit_cents INTEGER,
    member_monthly_budget_limit_cents INTEGER,
    audit_retention_days INTEGER,
    sso_config JSONB DEFAULT '{}'::jsonb,
    context_bias TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS context_bias TEXT;

  ALTER TABLE transcriptions       ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE templates             ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE template_categories   ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE folders               ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE usage_log             ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE api_keys              ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;
  ALTER TABLE audit_log             ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE SET NULL;
  ALTER TABLE transcription_events  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE;

  CREATE INDEX IF NOT EXISTS idx_transcriptions_org_created     ON transcriptions(organization_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_templates_org                  ON templates(organization_id);
  CREATE INDEX IF NOT EXISTS idx_template_categories_org        ON template_categories(organization_id);
  CREATE INDEX IF NOT EXISTS idx_folders_org                    ON folders(organization_id);
  CREATE INDEX IF NOT EXISTS idx_usage_log_org_created          ON usage_log(organization_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_api_keys_org                   ON api_keys(organization_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_org_created          ON audit_log(organization_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_transcription_events_org       ON transcription_events(organization_id);

  -- ===========================================================================
  -- Vexa Remote-Meeting integration. Bots and transcripts produced by an
  -- external Vexa Lite instance land back in the existing transcriptions
  -- table with source='vexa', so the rest of the pipeline (analyze, export,
  -- audit, retention) does not need to know about meetings as a separate
  -- concept. See docs/vexa-integration.md for the operator setup.
  -- ===========================================================================
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'upload';
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS meeting_platform VARCHAR(20);
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS native_meeting_id VARCHAR(160);
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS external_meeting_id VARCHAR(160);
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS bot_status VARCHAR(40);
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS meeting_started_at TIMESTAMP WITH TIME ZONE;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS meeting_ended_at TIMESTAMP WITH TIME ZONE;

  -- Live-translation companion-tab feature: each translated_segments
  -- entry mirrors the original segments shape (start,end,text,speaker,
  -- language) so the SSE/UI layers can render both side-by-side without
  -- a second join. translation_config is per-meeting; persisted at bot
  -- start and editable mid-meeting via PUT /api/meetings/[id]/translation.
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translated_segments JSONB DEFAULT NULL;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS translation_config JSONB DEFAULT NULL;

  -- Public share token for the live-translation companion view. Only
  -- the translation columns (segments + translated_segments +
  -- translation_config + status) are exposed via /share/[token]; the
  -- editor, analysis, raw audio file and any settings remain
  -- auth-gated. Token auto-expires after the meeting ends so a stale
  -- link can never re-open access.
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS public_share_token VARCHAR(64);
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS public_share_expires_at TIMESTAMP WITH TIME ZONE;
  -- Idempotency for the auto-post-into-chat behaviour: once we
  -- successfully posted the share-link in the meeting chat we set this
  -- timestamp; subsequent webhook events / toggle-flips will skip the
  -- post so participants don't see a wall of identical messages.
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS share_link_posted_at TIMESTAMP WITH TIME ZONE;

  -- Phase-1 in-meeting subtitles: the Vexa bot patches its getUserMedia
  -- and renders an HTML page (the /share/[token]/overlay route) onto
  -- its 1920x1080 webcam canvas. Participants then see the live
  -- translation as subtitles on the bot gallery tile.
  -- in_meeting_overlay_enabled is the per-meeting toggle; if false
  -- the bot camera shows the default Vexa avatar.
  -- overlay_started_at is the idempotency stamp for the screen-content
  -- POST so the webhook handler does not re-trigger the same overlay
  -- on every retried meeting.started event.
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS in_meeting_overlay_enabled BOOLEAN DEFAULT false;
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS overlay_started_at TIMESTAMP WITH TIME ZONE;

  -- Phase-2 in-meeting audio injection: when set to a language code
  -- (e.g. en) the bridge renders Voxtral TTS for every translated
  -- segment in that language and ships the PCM bytes to Vexa's /speak
  -- endpoint, so participants in the meeting hear the translation
  -- spoken alongside the original. NULL = audio injection off.
  -- One direction only by design (bidirectional speak collides with
  -- itself via PulseAudio tts_sink, plus social-acceptability is poor).
  ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS audio_injection_lang VARCHAR(8) DEFAULT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_share_token
    ON transcriptions(public_share_token) WHERE public_share_token IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_transcriptions_source_status
    ON transcriptions(source, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_external_meeting
    ON transcriptions(external_meeting_id) WHERE external_meeting_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS organization_integrations (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    provider VARCHAR(40) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    config_encrypted TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, provider)
  );
  CREATE INDEX IF NOT EXISTS idx_org_integrations_org
    ON organization_integrations(organization_id);

  CREATE TABLE IF NOT EXISTS vexa_user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    vexa_user_id INTEGER NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT ARRAY['bot','tx'],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (user_id, organization_id)
  );
  CREATE INDEX IF NOT EXISTS idx_vexa_tokens_org
    ON vexa_user_tokens(organization_id);

  CREATE TABLE IF NOT EXISTS vexa_webhook_events (
    event_id VARCHAR(80) PRIMARY KEY,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_vexa_webhook_events_received
    ON vexa_webhook_events(received_at);

  -- Per-user opt-out for the remote-meeting feature. Default true so the
  -- moment the workspace admin enables Vexa, every member sees the feature;
  -- individual users can hide it again from their normal settings tab.
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS remote_meeting_enabled BOOLEAN DEFAULT true;

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
