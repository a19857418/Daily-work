const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const TOKEN_TTL = process.env.TOKEN_TTL || '12h';

async function verifyLogin(username, password) {
  const res = await pool.query('SELECT id, username, password_hash, role FROM users WHERE username=$1', [username]);
  const user = res.rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, username: user.username, role: user.role };
}

// 簡化版「系統設定密碼解鎖」：不需要輸入帳號，只要密碼對得上任一 admin 帳號即可
// （適合單純化階段：只有極少數人會動到系統設定，共用一組密碼就夠）
async function verifyAdminPassword(password) {
  const res = await pool.query("SELECT id, username, password_hash FROM users WHERE role='admin'");
  for (const u of res.rows) {
    if (await bcrypt.compare(password, u.password_hash)) {
      return { id: u.id, username: u.username, role: 'admin' };
    }
  }
  return null;
}

function issueToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET 未設定');
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, secret, { expiresIn: TOKEN_TTL });
}

// 任何已登入帳號（admin 或 staff）皆可通過，僅驗證身份
function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: '伺服器未設定 JWT_SECRET，請聯絡管理員' });
  }
  const header = req.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: '未登入或憑證缺漏' });
  }
  try {
    const payload = jwt.verify(token, secret);
    req.user = { id: payload.sub, username: payload.username, role: payload.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: '憑證無效或已過期，請重新登入' });
  }
}

// 限定角色（例如只有 admin 能寫入設定）
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `此操作需要「${role}」權限，目前帳號角色為「${req.user?.role || '未登入'}」` });
    }
    next();
  };
}

module.exports = { verifyLogin, verifyAdminPassword, issueToken, requireAuth, requireRole };
