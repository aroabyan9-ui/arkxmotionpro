const express = require('express');
const router = express.Router();
const { klingKeyManager, magnificKeyManager } = require('../services/keyManager');
const { proxyManager } = require('../services/proxyManager');
const fs = require('fs-extra');

router.get('/', async (req, res) => {
  try {
    const history = await fs.readJson('./data/history.json').catch(() => []);
    const videoHistory = history.filter(h => h.type === 'video');
    const imageHistory = history.filter(h => h.type === 'image');
    
    res.json({
      success: true,
      kling: klingKeyManager.getStats(),
      magnific: magnificKeyManager.getStats(),
      proxy: proxyManager.getStats(),
      history: {
        total: history.length,
        videos: videoHistory.length,
        images: imageHistory.length,
        today: history.filter(h => new Date(h.createdAt).toDateString() === new Date().toDateString()).length
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
