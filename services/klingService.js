/**
 * ARKX Motion Pro - Kling AI Service
 * Supports: Kling 2.6, Kling 3 Pro, WAN AI, Seedance 2
 * Features: Text-to-Video, Image-to-Video, Motion Control
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const { klingKeyManager } = require('./keyManager');
const { v4: uuidv4 } = require('uuid');

const KLING_BASE_URL = 'https://api.klingai.com';
const WAN_BASE_URL = 'https://api.wan-ai.com';
const SEEDANCE_BASE_URL = 'https://api.seedance.ai';

// Model configurations
const MODEL_CONFIG = {
  'kling-2.6': {
    provider: 'kling',
    baseUrl: KLING_BASE_URL,
    model: 'kling-v2-6',
    maxDuration: 15,
    motionControl: true,
    textToVideo: true,
    imageToVideo: true,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
  },
  'kling-3-pro': {
    provider: 'kling',
    baseUrl: KLING_BASE_URL,
    model: 'kling-v3-pro',
    maxDuration: 15,
    motionControl: true,
    textToVideo: true,
    imageToVideo: true,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
  },
  'kling-motion-control': {
    provider: 'kling',
    baseUrl: KLING_BASE_URL,
    model: 'kling-v3-pro',
    maxDuration: 30,
    motionControl: true,
    textToVideo: false,
    imageToVideo: true,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4']
  },
  'wan-ai': {
    provider: 'wan',
    baseUrl: WAN_BASE_URL,
    model: 'wan-2.1',
    maxDuration: 15,
    motionControl: false,
    textToVideo: true,
    imageToVideo: true,
    ratios: ['16:9', '9:16', '1:1', '4:3']
  },
  'seedance-2': {
    provider: 'seedance',
    baseUrl: SEEDANCE_BASE_URL,
    model: 'seedance-v2',
    maxDuration: 15,
    motionControl: false,
    textToVideo: true,
    imageToVideo: true,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4']
  }
};

class KlingService {
  constructor() {
    this.jobs = new Map();
    this.logFile = './logs/kling_requests.log';
  }

  async generateVideo(params) {
    const {
      model = 'kling-2.6',
      mode = 'text-to-video', // 'text-to-video' | 'image-to-video' | 'motion-control'
      prompt,
      negativePrompt = '',
      imageUrl,
      referenceVideoUrl,
      duration = 5,
      ratio = '16:9',
      quality = 'high',
      seed,
      motionStrength = 0.5,
      cameraControl,
      jobId = uuidv4()
    } = params;

    const config = MODEL_CONFIG[model];
    if (!config) throw new Error(`Unknown model: ${model}`);

    // Validate duration
    const maxDur = mode === 'motion-control' ? 30 : 15;
    const finalDuration = Math.min(duration, maxDur);

    // Get API key
    const keyObj = klingKeyManager.getNextKey();
    if (!keyObj) throw new Error('No active Kling API keys available. Please add API keys.');

    const startTime = Date.now();
    this._log('REQUEST', { jobId, model, mode, prompt: prompt?.substring(0, 50) });
    this._emitProgress(jobId, 'starting', 0, 'Initializing generation...');

    try {
      let result;
      
      if (config.provider === 'kling') {
        result = await this._klingGenerate({ ...params, config, keyObj, finalDuration, jobId });
      } else if (config.provider === 'wan') {
        result = await this._wanGenerate({ ...params, config, keyObj, finalDuration, jobId });
      } else if (config.provider === 'seedance') {
        result = await this._seedanceGenerate({ ...params, config, keyObj, finalDuration, jobId });
      }

      const latency = Date.now() - startTime;
      klingKeyManager.markSuccess(keyObj.id, latency);
      
      // Save to history
      await this._saveHistory({ jobId, model, mode, prompt, result, duration: finalDuration, ratio, latency });
      
      this._emitProgress(jobId, 'completed', 100, 'Generation complete!');
      this._log('SUCCESS', { jobId, latency, videoUrl: result.videoUrl });
      
      return { success: true, jobId, ...result };

    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      const status = error.response?.status;
      
      // Detect quota/auth errors
      if (status === 401 || status === 403 || errMsg?.includes('unauthorized') || errMsg?.includes('invalid key')) {
        klingKeyManager.markError(keyObj.id, errMsg, true);
      } else if (status === 429 || errMsg?.includes('quota') || errMsg?.includes('limit')) {
        klingKeyManager.markQuotaExhausted(keyObj.id);
        // Retry with next key
        return this.generateVideo(params);
      } else {
        klingKeyManager.markError(keyObj.id, errMsg);
      }

      this._emitProgress(jobId, 'failed', 0, errMsg);
      this._log('ERROR', { jobId, error: errMsg, status });
      throw new Error(errMsg);
    }
  }

  async _klingGenerate({ config, keyObj, prompt, negativePrompt, imageUrl, referenceVideoUrl, finalDuration, ratio, quality, seed, motionStrength, cameraControl, mode, jobId }) {
    const headers = {
      'Authorization': `Bearer ${keyObj.key}`,
      'Content-Type': 'application/json'
    };

    let endpoint, body;

    if (mode === 'text-to-video') {
      endpoint = `${config.baseUrl}/v1/videos/text2video`;
      body = {
        model: config.model,
        prompt,
        negative_prompt: negativePrompt,
        duration: finalDuration,
        aspect_ratio: ratio,
        quality,
        ...(seed && { seed })
      };
    } else if (mode === 'image-to-video') {
      endpoint = `${config.baseUrl}/v1/videos/image2video`;
      body = {
        model: config.model,
        image_url: imageUrl,
        prompt,
        negative_prompt: negativePrompt,
        duration: finalDuration,
        aspect_ratio: ratio,
        quality,
        motion_strength: motionStrength,
        ...(seed && { seed })
      };
    } else if (mode === 'motion-control') {
      endpoint = `${config.baseUrl}/v1/videos/motion-control`;
      body = {
        model: config.model,
        image_url: imageUrl,
        reference_video_url: referenceVideoUrl,
        prompt: prompt || '',
        duration: finalDuration,
        aspect_ratio: ratio,
        ...(cameraControl && { camera_control: cameraControl }),
        ...(seed && { seed })
      };
    }

    this._emitProgress(jobId, 'processing', 20, 'Sending to Kling AI...');

    // Submit task
    const submitRes = await axios.post(endpoint, body, { headers, timeout: 30000 });
    const taskId = submitRes.data?.data?.task_id || submitRes.data?.task_id;
    
    if (!taskId) throw new Error('Failed to get task ID from Kling AI');

    this._emitProgress(jobId, 'processing', 40, `Task submitted: ${taskId}`);

    // Poll for result
    return await this._pollKlingTask(taskId, keyObj, config, jobId);
  }

  async _pollKlingTask(taskId, keyObj, config, jobId) {
    const headers = { 'Authorization': `Bearer ${keyObj.key}` };
    const maxAttempts = 120; // 10 minutes max
    let attempt = 0;

    while (attempt < maxAttempts) {
      await this._sleep(5000);
      attempt++;

      const progress = Math.min(40 + (attempt / maxAttempts) * 55, 95);
      this._emitProgress(jobId, 'processing', progress, `Processing... (${attempt * 5}s)`);

      try {
        const res = await axios.get(`${config.baseUrl}/v1/videos/tasks/${taskId}`, { headers, timeout: 15000 });
        const data = res.data?.data || res.data;
        const status = data?.status || data?.task_status;

        if (status === 'succeed' || status === 'completed' || status === 'success') {
          const videoUrl = data?.task_result?.videos?.[0]?.url || 
                          data?.result?.video_url || 
                          data?.video_url ||
                          data?.output?.video_url;
          
          if (!videoUrl) throw new Error('No video URL in response');
          
          return {
            videoUrl,
            taskId,
            thumbnailUrl: data?.task_result?.videos?.[0]?.cover_image_url || null,
            duration: data?.task_result?.videos?.[0]?.duration || null
          };
        } else if (status === 'failed' || status === 'error') {
          throw new Error(data?.task_result?.message || data?.error || 'Task failed');
        }
        // Still processing, continue polling
      } catch (pollErr) {
        if (pollErr.response?.status === 404) throw new Error('Task not found');
        if (attempt >= maxAttempts - 1) throw pollErr;
      }
    }
    throw new Error('Generation timeout - task took too long');
  }

  async _wanGenerate({ config, keyObj, prompt, negativePrompt, imageUrl, finalDuration, ratio, mode, jobId }) {
    const headers = {
      'Authorization': `Bearer ${keyObj.key}`,
      'Content-Type': 'application/json'
    };

    this._emitProgress(jobId, 'processing', 20, 'Sending to WAN AI...');

    const body = {
      model: config.model,
      prompt,
      negative_prompt: negativePrompt,
      duration: finalDuration,
      aspect_ratio: ratio,
      ...(imageUrl && { image_url: imageUrl }),
      mode: mode === 'image-to-video' ? 'i2v' : 't2v'
    };

    const submitRes = await axios.post(`${config.baseUrl}/v1/generate`, body, { headers, timeout: 30000 });
    const taskId = submitRes.data?.task_id || submitRes.data?.id;
    if (!taskId) throw new Error('Failed to get task ID from WAN AI');

    this._emitProgress(jobId, 'processing', 40, `WAN AI task: ${taskId}`);

    // Poll
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await this._sleep(5000);
      const progress = Math.min(40 + (i / maxAttempts) * 55, 95);
      this._emitProgress(jobId, 'processing', progress, `WAN AI processing... (${i * 5}s)`);

      const res = await axios.get(`${config.baseUrl}/v1/tasks/${taskId}`, { headers, timeout: 15000 });
      const data = res.data;
      
      if (data?.status === 'completed' || data?.status === 'success') {
        return { videoUrl: data.video_url || data.output?.url, taskId };
      } else if (data?.status === 'failed') {
        throw new Error(data.error || 'WAN AI generation failed');
      }
    }
    throw new Error('WAN AI generation timeout');
  }

  async _seedanceGenerate({ config, keyObj, prompt, negativePrompt, imageUrl, finalDuration, ratio, mode, jobId }) {
    const headers = {
      'Authorization': `Bearer ${keyObj.key}`,
      'Content-Type': 'application/json'
    };

    this._emitProgress(jobId, 'processing', 20, 'Sending to Seedance 2...');

    const body = {
      model: config.model,
      prompt,
      negative_prompt: negativePrompt,
      duration: finalDuration,
      aspect_ratio: ratio,
      ...(imageUrl && { init_image: imageUrl }),
      type: mode === 'image-to-video' ? 'img2vid' : 'txt2vid'
    };

    const submitRes = await axios.post(`${config.baseUrl}/v1/video/generate`, body, { headers, timeout: 30000 });
    const taskId = submitRes.data?.data?.id || submitRes.data?.id;
    if (!taskId) throw new Error('Failed to get task ID from Seedance');

    this._emitProgress(jobId, 'processing', 40, `Seedance task: ${taskId}`);

    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await this._sleep(5000);
      const progress = Math.min(40 + (i / maxAttempts) * 55, 95);
      this._emitProgress(jobId, 'processing', progress, `Seedance processing... (${i * 5}s)`);

      const res = await axios.get(`${config.baseUrl}/v1/video/task/${taskId}`, { headers, timeout: 15000 });
      const data = res.data?.data || res.data;
      
      if (data?.status === 'success' || data?.status === 'completed') {
        return { videoUrl: data.video_url || data.url, taskId };
      } else if (data?.status === 'failed' || data?.status === 'error') {
        throw new Error(data.message || 'Seedance generation failed');
      }
    }
    throw new Error('Seedance generation timeout');
  }

  _emitProgress(jobId, status, progress, message) {
    if (global.io) {
      global.io.to(`job_${jobId}`).emit('job_progress', { jobId, status, progress, message, timestamp: Date.now() });
      global.io.emit('job_update', { jobId, status, progress, message });
    }
  }

  async _saveHistory(data) {
    try {
      const history = await fs.readJson('./data/history.json').catch(() => []);
      history.unshift({ ...data, createdAt: new Date().toISOString(), type: 'video' });
      if (history.length > 500) history.splice(500);
      await fs.writeJson('./data/history.json', history, { spaces: 2 });
    } catch (e) { console.error('History save error:', e.message); }
  }

  _log(type, data) {
    const entry = `[${new Date().toISOString()}] [${type}] ${JSON.stringify(data)}\n`;
    fs.appendFile(this.logFile, entry).catch(() => {});
    if (global.io) global.io.emit('debug_log', { type, data, timestamp: Date.now() });
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  getModelConfig() { return MODEL_CONFIG; }
}

module.exports = new KlingService();
