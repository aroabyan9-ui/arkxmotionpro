const express = require('express');
const router = express.Router();
const { proxyManager } = require('../services/proxyManager');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', (req, res) => res.json({ success: true, proxies: proxyManager.getAll(), stats: proxyManager.getStats() }));

router.post('/add', (req, res) => {
  const { url, label } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  res.json(proxyManager.addProxy(url, label));
});

router.post('/add-bulk', (req, res) => {
  const { proxies } = req.body;
  if (!Array.isArray(proxies)) return res.status(400).json({ error: 'proxies must be array' });
  res.json({ success: true, results: proxyManager.addProxies(proxies) });
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const lines = req.file.buffer.toString().split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const results = proxyManager.addProxies(lines);
  res.json({ success: true, added: results.filter(r => r.success).length });
});

router.delete('/:id', (req, res) => res.json(proxyManager.removeProxy(req.params.id)));

module.exports = router;
