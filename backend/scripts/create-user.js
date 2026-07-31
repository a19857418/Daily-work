require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

async function main() {
  const [, , username, password, role] = process.argv;
  if (!username || !password || !role || !['admin', 'staff'].includes(role)) {
    console.error('用法：npm run create-user -- <username> <password> <admin|staff>');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE SET password_hash = $2, role = $3`,
    [username, hash, role]
  );
  console.log(`已建立/更新使用者：${username}（角色：${role}）`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
