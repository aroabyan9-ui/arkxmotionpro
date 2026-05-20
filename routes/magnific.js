const express = require('express');
const router = express.Router();
const magnificService = require('../services/magnificService');
const { v4: uuidv4 } = require('uuid');

// Process image (async)
router.post('/process', async (req, res) => {
  try {
    const jobId = uuidv4();
    res.json({ success: true, jobId, message: 'Processing started' });
    
    magnificService.process({ ...req.body, jobId }).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Process sync
router.post('/process/sync', async (req, res) => {
  try {
    const jobId = uuidv4();
    const result = await magnificService.process({ ...req.body, jobId });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upscale shortcut
router.post('/upscale', async (req, res) => {
  try {
    const jobId = uuidv4();
    res.json({ success: true, jobId, message: 'Upscale started' });
    magnificService.process({ feature: 'upscale', ...req.body, jobId }).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Enhance shortcut
router.post('/enhance', async (req, res) => {
  try {
    const jobId = uuidv4();
    res.json({ success: true, jobId, message: 'Enhancement started' });
    magnificService.process({ feature: 'enhance', ...req.body, jobId }).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Relight shortcut
router.post('/relight', async (req, res) => {
  try {
    const jobId = uuidv4();
    res.json({ success: true, jobId, message: 'Relight started' });
    magnificService.process({ feature: 'relight', ...req.body, jobId }).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sharpen shortcut
router.post('/sharpen', async (req, res) => {
  try {
    const jobId = uuidv4();
    res.json({ success: true, jobId, message: 'Sharpen started' });
    magnificService.process({ feature: 'sharpen', ...req.body, jobId }).catch(err => {
      if (global.io) global.io.emit('job_error', { jobId, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
