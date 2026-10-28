// Accès PostgreSQL : Neon (WebSocket) en ligne, pg en local.
const { SCHEMA, SCHEMA_VERSION } = require('./schema');

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

let localPool = null;

function makePool() {
  const url = databaseUrl();
  if (!url) {
    const err = new Error('Base de données non configurée (DATABASE_URL manquant)');
    err.status = 503;
    throw err;
  }
  if (/neon\.tech/.test(url)) {
    // Un pool par requête : les fonctions serverless ne gardent pas de connexion ouverte
    const { Pool } = require('@neondatabase/serverless');
    return { pool: new Pool({ connectionString: url }), shared: false };
  }
  if (!localPool) {
    const { Pool } = require('pg');
    localPool = new Pool({ connectionString: url, max: 5 });
  }
  return { pool: localPool, shared: true };
}

let schemaReady = null;

async function ensureSchema(pool) {
  const { rows } = await pool.query(
    "SELECT to_regclass('public.schema_meta') AS t"
  );
  if (rows[0].t) {
    const v = await pool.query('SELECT version FROM schema_meta LIMIT 1');
    if (v.rows[0] && v.rows[0].version >= SCHEMA_VERSION) return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(424242)');
    await client.query(SCHEMA);
    await client.query('DELETE FROM schema_meta');
    await client.query('INSERT INTO schema_meta(version) VALUES ($1)', [SCHEMA_VERSION]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Ouvre une session base pour la durée d'une requête HTTP
async function open() {
  const { pool, shared } = makePool();
  if (!schemaReady) schemaReady = ensureSchema(pool).catch(e => { schemaReady = null; throw e; });
  await schemaReady;

  const db = {
    async query(text, params) {
      const r = await pool.query(text, params);
      return r.rows;
    },
    async one(text, params) {
      const r = await pool.query(text, params);
      return r.rows[0] || null;
    },
    // Exécute fn dans une transaction ; fn reçoit un objet { query, one }
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const t = {
          query: async (q, p) => (await client.query(q, p)).rows,
          one: async (q, p) => (await client.query(q, p)).rows[0] || null,
        };
        const out = await fn(t);
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!shared) await pool.end().catch(() => {});
    },
  };
  return db;
}

module.exports = { open };
