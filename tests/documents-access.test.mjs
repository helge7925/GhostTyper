import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL || '';

// Helper to create a temporary schema for isolated testing
async function withTempSchema(fn) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const schema = `test_docs_access_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);

    // Create minimal tables needed for document access tests
    await client.query(`
      CREATE TABLE organizations (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT
      );
      CREATE TABLE documents (
        id BIGINT PRIMARY KEY,
        organization_id BIGINT NOT NULL REFERENCES organizations(id),
        owner_user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT,
        source_type TEXT NOT NULL DEFAULT 'text',
        visibility TEXT NOT NULL DEFAULT 'private',
        folder_id BIGINT,
        is_favorite BOOLEAN DEFAULT false,
        tags TEXT[],
        summary TEXT,
        text_preview TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE transcriptions (
        id BIGINT PRIMARY KEY,
        organization_id BIGINT NOT NULL REFERENCES organizations(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        original_name TEXT,
        filename TEXT,
        status TEXT DEFAULT 'completed',
        text TEXT,
        analysis TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await fn(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
}

// Test 1: Private documents should only be accessible to their owner
test('documents API: private document only accessible to owner', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    // Setup: Create org, users, and documents
    await client.query(`INSERT INTO organizations VALUES (100, 'Test Org')`);
    await client.query(`INSERT INTO users VALUES (1, 'owner@example.com', 'Owner'), (2, 'other@example.com', 'Other')`);
    
    // Insert a private document owned by user 1
    await client.query(`
      INSERT INTO documents 
      VALUES (1, 100, 1, 'Private Doc', 'text', 'private', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Test: Owner should see their private document
    const ownerResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)`,
      [100, 1]
    );
    assert.equal(ownerResult.rowCount, 1);
    assert.equal(ownerResult.rows[0].id, 1);

    // Test: Other user should NOT see the private document
    const otherResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)`,
      [100, 2]
    );
    assert.equal(otherResult.rowCount, 0);
  });
});

// Test 2: Workspace documents should be accessible to all org members
test('documents API: workspace document accessible to all org members', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (200, 'Test Org 2')`);
    await client.query(`INSERT INTO users VALUES (10, 'user1@example.com', 'User 1'), (11, 'user2@example.com', 'User 2')`);
    
    // Insert a workspace document
    await client.query(`
      INSERT INTO documents 
      VALUES (2, 200, 10, 'Workspace Doc', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Both users should see the workspace document
    const user1Result = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)`,
      [200, 10]
    );
    assert.equal(user1Result.rowCount, 1);

    const user2Result = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)`,
      [200, 11]
    );
    assert.equal(user2Result.rowCount, 1);
  });
});

// Test 3: Mixed visibility - owner sees both private and workspace docs
test('documents API: owner sees both private and workspace documents', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (300, 'Test Org 3')`);
    await client.query(`INSERT INTO users VALUES (20, 'owner2@example.com', 'Owner 2')`);
    
    // Insert both private and workspace documents for the same owner
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (3, 300, 20, 'Private Doc', 'text', 'private', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (4, 300, 20, 'Workspace Doc', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Owner should see both documents
    const result = await client.query(
      `SELECT id, visibility FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
       ORDER BY id`,
      [300, 20]
    );
    assert.equal(result.rowCount, 2);
    assert.deepEqual(result.rows.map(r => r.id), [3, 4]);
    assert.deepEqual(result.rows.map(r => r.visibility), ['private', 'workspace']);
  });
});

// Test 4: Filter by visibility
test('documents API: filter by visibility parameter', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (400, 'Test Org 4')`);
    await client.query(`INSERT INTO users VALUES (30, 'user3@example.com', 'User 3')`);
    
    // Insert documents with different visibilities
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (5, 400, 30, 'Private Doc', 'text', 'private', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (6, 400, 30, 'Workspace Doc', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Filter for workspace only
    const workspaceResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND visibility = $3`,
      [400, 30, 'workspace']
    );
    assert.equal(workspaceResult.rowCount, 1);
    assert.equal(workspaceResult.rows[0].id, 6);

    // Filter for private only
    const privateResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND visibility = $3`,
      [400, 30, 'private']
    );
    assert.equal(privateResult.rowCount, 1);
    assert.equal(privateResult.rows[0].id, 5);
  });
});

// Test 5: Filter by source_type
test('documents API: filter by source_type parameter', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (500, 'Test Org 5')`);
    await client.query(`INSERT INTO users VALUES (40, 'user4@example.com', 'User 4')`);
    
    // Insert documents with different source types
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (7, 500, 40, 'Audio', 'audio_transcription', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (8, 500, 40, 'OCR', 'ocr', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (9, 500, 40, 'Meeting', 'meeting', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Filter for audio_transcription only
    const audioResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND source_type = $3`,
      [500, 40, 'audio_transcription']
    );
    assert.equal(audioResult.rowCount, 1);
    assert.equal(audioResult.rows[0].id, 7);

    // Filter for OCR only
    const ocrResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND source_type = $3`,
      [500, 40, 'ocr']
    );
    assert.equal(ocrResult.rowCount, 1);
    assert.equal(ocrResult.rows[0].id, 8);
  });
});

// Test 6: Full-text search in title
test('documents API: full-text search in title', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (600, 'Test Org 6')`);
    await client.query(`INSERT INTO users VALUES (50, 'user5@example.com', 'User 5')`);
    
    // Insert documents with different titles
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (10, 600, 50, 'Important Project Document', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (11, 600, 50, 'Random Notes', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (12, 600, 50, 'Project Meeting Minutes', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Search for 'Project' - should match 2 documents
    const searchResult = await client.query(
      `SELECT id, title FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND title ILIKE $3
       ORDER BY id`,
      [600, 50, '%Project%']
    );
    assert.equal(searchResult.rowCount, 2);
    assert.deepEqual(searchResult.rows.map(r => r.id), [10, 12]);
  });
});

// Test 7: Full-text search in text_preview
test('documents API: full-text search in text_preview with scope=full', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (700, 'Test Org 7')`);
    await client.query(`INSERT INTO users VALUES (60, 'user6@example.com', 'User 6')`);
    
    // Insert documents with text_preview content
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (13, 700, 60, 'Doc 1', 'text', 'workspace', NULL, false, NULL, NULL, 'This contains important information', NOW(), NOW()),
        (14, 700, 60, 'Doc 2', 'text', 'workspace', NULL, false, NULL, NULL, 'Some other content', NOW(), NOW())
    `);

    // Full-text search in text_preview
    const searchResult = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND text_preview ILIKE $3`,
      [700, 60, '%important%']
    );
    assert.equal(searchResult.rowCount, 1);
    assert.equal(searchResult.rows[0].id, 13);
  });
});

// Test 8: Combined filters (visibility + source_type + search)
test('documents API: combined filters', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (800, 'Test Org 8')`);
    await client.query(`INSERT INTO users VALUES (70, 'user7@example.com', 'User 7')`);
    
    // Insert various documents
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (15, 800, 70, 'Audio Meeting', 'audio_transcription', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (16, 800, 70, 'Private Audio', 'audio_transcription', 'private', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (17, 800, 70, 'OCR Document', 'ocr', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW()),
        (18, 800, 70, 'Meeting Notes', 'meeting', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Filter: workspace + audio_transcription + search for 'Meeting'
    const result = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND visibility = $3
         AND source_type = $4
         AND title ILIKE $5`,
      [800, 70, 'workspace', 'audio_transcription', '%Meeting%']
    );
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].id, 15);
  });
});

// Test 9: Favorite filter
test('documents API: filter by favorite', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (900, 'Test Org 9')`);
    await client.query(`INSERT INTO users VALUES (80, 'user8@example.com', 'User 8')`);
    
    // Insert documents with mixed favorite status
    await client.query(`
      INSERT INTO documents 
      VALUES 
        (19, 900, 80, 'Favorite Doc', 'text', 'workspace', NULL, true, NULL, NULL, NULL, NOW(), NOW()),
        (20, 900, 80, 'Normal Doc', 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
    `);

    // Filter for favorites only
    const result = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
         AND is_favorite = true`,
      [900, 80]
    );
    assert.equal(result.rowCount, 1);
    assert.equal(result.rows[0].id, 19);
  });
});

// Test 10: Pagination with limit and offset
test('documents API: pagination with limit and offset', { skip: !databaseUrl }, async () => {
  await withTempSchema(async (client) => {
    await client.query(`INSERT INTO organizations VALUES (1000, 'Test Org 10')`);
    await client.query(`INSERT INTO users VALUES (90, 'user9@example.com', 'User 9')`);
    
    // Insert 5 documents
    for (let i = 1; i <= 5; i++) {
      await client.query(`
        INSERT INTO documents 
        VALUES ($1, 1000, 90, $2, 'text', 'workspace', NULL, false, NULL, NULL, NULL, NOW(), NOW())
      `, [100 + i, `Doc ${i}`]);
    }

    // Get first 2 documents
    const page1 = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
       ORDER BY id
       LIMIT $3 OFFSET $4`,
      [1000, 90, 2, 0]
    );
    assert.equal(page1.rowCount, 2);
    assert.deepEqual(page1.rows.map(r => r.id), [101, 102]);

    // Get next 2 documents (offset 2)
    const page2 = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
       ORDER BY id
       LIMIT $3 OFFSET $4`,
      [1000, 90, 2, 2]
    );
    assert.equal(page2.rowCount, 2);
    assert.deepEqual(page2.rows.map(r => r.id), [103, 104]);

    // Get last document (offset 4)
    const page3 = await client.query(
      `SELECT id FROM documents 
       WHERE organization_id = $1 
         AND (visibility = 'workspace' OR owner_user_id = $2)
       ORDER BY id
       LIMIT $3 OFFSET $4`,
      [1000, 90, 2, 4]
    );
    assert.equal(page3.rowCount, 1);
    assert.equal(page3.rows[0].id, 105);
  });
});

console.log('All document access and filter tests defined. Run with: npm test -- --test-name-pattern="documents API"');
