const express = require('express');
const { verifyLogin, issueToken } = require('../auth');

const router = express.Router();

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

module.exports = router;
