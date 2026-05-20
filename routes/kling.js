const express = require('express');
const router = express.Router();
const klingService = require('../services/klingService');
const { v4: uuidv4 } = require('uuid');

// Generate video
router.post('/generate', async (req, res) => {
  try {
    const jobId = uuidv4();
    const params = { ...req.body, jobId };
    
    // Start async generation
    res.json({ success: true, jobId, message: 'Generation started' });
    
    // Process in background
    klingService.generateVideo(params).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate sync (wait for result)
router.post('/generate/sync', async (req, res) => {
  try {
    const jobId = uuidv4();
    const result = await klingService.generateVideo({ ...req.body, jobId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get model configs
router.get('/models', (req, res) => {
  res.json({ success: true, models: klingService.getModelConfig() });
});

module.exports = router;
