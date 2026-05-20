const express = require('express');
const router = express.Router();
const { klingKeyManager, magnificKeyManager } = require('../services/keyManager');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

function getManager(type) {
  if (type === 'kling') return klingKeyManager;
  if (type === 'magnific') return magnificKeyManager;
  return null;
}

// Get all keys (masked)
router.get('/:type', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  res.json({ success: true, keys: mgr.getAllKeys(), stats: mgr.getStats() });
});

// Add single key
router.post('/:type/add', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  const { key, label } = req.body;
  if (!key) return res.status(400).json({ error: 'Key is required' });
  const result = mgr.addKey(key.trim(), label);
  res.json(result);
});

// Add multiple keys (JSON array)
router.post('/:type/add-bulk', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  const { keys } = req.body;
  if (!Array.isArray(keys)) return res.status(400).json({ error: 'keys must be an array' });
  const results = mgr.addKeys(keys);
  res.json({ success: true, results, added: results.filter(r => r.success).length });
});

// Upload keys from text file
router.post('/:type/upload', upload.single('file'), (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  
  const content = req.file.buffer.toString('utf-8');
  const keys = content.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  
  const results = mgr.addKeys(keys);
  res.json({ 
    success: true, 
    total: keys.length,
    added: results.filter(r => r.success).length,
    duplicates: results.filter(r => !r.success).length
  });
});

// Remove key
router.delete('/:type/:id', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  res.json(mgr.removeKey(req.params.id));
});

// Reset key (reactivate)
router.post('/:type/:id/reset', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  res.json(mgr.resetKey(req.params.id));
});

// Get stats
router.get('/:type/stats/summary', (req, res) => {
  const mgr = getManager(req.params.type);
  if (!mgr) return res.status(400).json({ error: 'Invalid type' });
  res.json({ success: true, stats: mgr.getStats() });
});

module.exports = router;
