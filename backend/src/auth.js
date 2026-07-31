function requireApiKey(req, res, next) {
  const configuredKey = process.env.API_KEY;
  if (!configuredKey) {
    return res.status(500).json({ error: '伺服器未設定 API_KEY，請聯絡管理員' });
  }
  const provided = req.get('X-Api-Key');
  if (provided !== configuredKey) {
    return res.status(401).json({ error: '未授權：API Key 錯誤或缺漏' });
  }
  next();
}

module.exports = { requireApiKey };
