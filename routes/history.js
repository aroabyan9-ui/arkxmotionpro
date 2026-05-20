const express = require('express');
const router = express.Router();
const fs = require('fs-extra');

router.get('/', async (req, res) => {
  try {
    const history = await fs.readJson('./data/history.json').catch(() => []);
    const { page = 1, limit = 20, type } = req.query;
    let filtered = type ? history.filter(h => h.type === type) : history;
    const total = filtered.length;
    const start = (page - 1) * limit;
    filtered = filtered.slice(start, start + parseInt(limit));
    res.json({ success: true, history: filtered, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:jobId', async (req, res) => {
  try {
    const history = await fs.readJson('./data/history.json').catch(() => []);
    const filtered = history.filter(h => h.jobId !== req.params.jobId);
    await fs.writeJson('./data/history.json', filtered, { spaces: 2 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    await fs.writeJson('./data/history.json', [], { spaces: 2 });
    res.json({ success: true, message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
