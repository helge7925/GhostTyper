const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const readline = require('readline');

// Minimalistische DB-Config für das Skript
// Nutzt DATABASE_URL aus der Umgebung (oder Standardwert für Docker)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://transkription:transkription@localhost:5432/transkription',
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function seed() {
  console.log('--- GhostTyper Admin Seed Tool ---');
  
  const email = await question('E-Mail des Admins: ');
  const name = await question('Name des Admins: ');
  const password = await question('Passwort: ');

  if (!email || !password) {
    console.error('Fehler: E-Mail und Passwort sind erforderlich!');
    process.exit(1);
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Check if user exists
    const res = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (res.rows.length > 0) {
      // Update existing
      await pool.query(
        "UPDATE users SET name = $1, password_hash = $2, role = 'admin', updated_at = NOW() WHERE email = $3",
        [name || null, passwordHash, email]
      );
      console.log(`Erfolg: Bestehender Benutzer ${email} wurde zum Admin hochgestuft und das Passwort aktualisiert.`);
    } else {
      // Create new
      await pool.query(
        "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin')",
        [email, name || null, passwordHash]
      );
      console.log(`Erfolg: Neuer Admin ${email} wurde erstellt.`);
    }
  } catch (error) {
    console.error('Fehler beim Seeding:', error);
  } finally {
    await pool.end();
    rl.close();
  }
}

seed();
