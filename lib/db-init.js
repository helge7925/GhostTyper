import { query } from './db';

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
    default_template VARCHAR(100) DEFAULT 'meeting',
    language VARCHAR(10) DEFAULT 'de',
    context_bias TEXT,
    preferred_model VARCHAR(100) DEFAULT 'mistral-large-latest',
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
`;

const migrations = `
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(100) DEFAULT 'mistral-large-latest';
  ALTER TABLE settings ADD COLUMN IF NOT EXISTS cost_limit NUMERIC(10,2) DEFAULT NULL;
`;

export async function initDatabase() {
  try {
    await query(schema);
    await query(migrations);
    console.log('Database schema initialized');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}
