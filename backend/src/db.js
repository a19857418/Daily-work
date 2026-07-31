const { Pool } = require('pg');

// 三種連線方式擇一：
// 1) DATABASE_URL 完整連線字串（本機開發最簡單）
// 2) INSTANCE_UNIX_SOCKET（GCP Cloud Run 透過 Cloud SQL 連接器掛載的 unix socket 路徑）
// 3) DB_HOST/DB_PORT 一般 TCP 連線
function buildConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
  if (process.env.INSTANCE_UNIX_SOCKET) {
    config.host = process.env.INSTANCE_UNIX_SOCKET; // 例如 /cloudsql/PROJECT:REGION:INSTANCE
  } else {
    config.host = process.env.DB_HOST || 'localhost';
    config.port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432;
  }
  return config;
}

const pool = new Pool(buildConfig());

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
