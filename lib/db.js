import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 2000, // How long to wait before timing out when connecting a new client
});

export default pool;

export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    // Log slow queries if they take more than 100ms
    if (duration > 100) {
      console.log('Slow query:', { text, duration, rows: result.rowCount });
    }
    return result;
  } catch (error) {
    console.error('Database query error:', { text, error });
    throw error;
  }
}

/**
 * Resolves a template ID (either standard or custom) to its corresponding
 * template name or custom prompt text.
 */
export async function resolveTemplate(templateId, userId) {
  // 1. Try to find a user-specific override in the templates table (by ID or by name)
  try {
    let queryText = 'SELECT prompt_text FROM templates WHERE (id::text = $1 OR name = $1) AND user_id = $2';
    let cleanId = templateId;
    
    if (templateId?.startsWith('custom-')) {
      cleanId = templateId.replace('custom-', '');
      queryText = 'SELECT prompt_text FROM templates WHERE id::text = $1 AND user_id = $2';
    }

    const result = await query(queryText, [cleanId, userId]);
    if (result.rows.length > 0) {
      return result.rows[0].prompt_text;
    }
  } catch (error) {
    console.error('Error resolving template from DB:', error);
  }

  // 2. Fallback to hardcoded defaults if not found in DB
  if (['meeting', 'aufmass', 'generic'].includes(templateId)) {
    return templateId; // lib/ai-service.js still handles these strings if not overridden
  }
  
  return 'generic';
}
