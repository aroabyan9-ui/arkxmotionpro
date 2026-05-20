const express = require('express');
const router = express.Router();
const fs = require('fs-extra');

router.get('/logs/:type', async (req, res) => {
  try {
    const logFile = `./logs/${req.params.type}_requests.log`;
    if (!await fs.pathExists(logFile)) return res.json({ logs: [] });
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-200);
    res.json({ success: true, logs: lines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/logs/:type', async (req, res) => {
  try {
    await fs.writeFile(`./logs/${req.params.type}_requests.log`, '');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/health', (req, res) => {
  const { klingKeyManager, magnificKeyManager } = require('../services/keyManager');
  const { proxyManager } = require('../services/proxyManager');
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    kling_keys: klingKeyManager.getStats(),
    magnific_keys: magnificKeyManager.getStats(),
    proxies: proxyManager.getStats(),
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
