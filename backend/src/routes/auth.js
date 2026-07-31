const express = require('express');
const { verifyLogin, verifyAdminPassword, issueToken } = require('../auth');

const router = express.Router();

// 完整帳密登入（保留給未來需要區分多個帳號時使用）
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '請輸入帳號密碼' });
    const user = await verifyLogin(username, password);
    if (!user) return res.status(401).json({ error: '帳號或密碼錯誤' });
    const token = issueToken(user);
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

// 簡化版：只需輸入密碼即可解鎖系統設定（前端目前使用這一支）
router.post('/unlock-settings', async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: '請輸入密碼' });
    const user = await verifyAdminPassword(password);
    if (!user) return res.status(401).json({ error: '密碼錯誤' });
    const token = issueToken(user);
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
