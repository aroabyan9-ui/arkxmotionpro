/**
 * ARKX Motion Pro - Magnific AI Service
 * Features: Upscale, Enhance Realism, AI Relight, Skin Texture Sharpen
 * Auto-rotate API keys + Proxy support
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const { magnificKeyManager } = require('./keyManager');
const { proxyManager } = require('./proxyManager');
const { v4: uuidv4 } = require('uuid');

const MAGNIFIC_BASE_URL = 'https://engine.magnific.ai';
const MAGNIFIC_API_URL = 'https://api.magnific.ai';

// Magnific endpoints
const ENDPOINTS = {
  upscale: '/v1/upscale',
  enhance: '/v1/enhance',
  relight: '/v1/relight',
  sharpen: '/v1/sharpen',
  status: '/v1/task',
  upload: '/v1/upload'
};

class MagnificService {
  constructor() {
    this.logFile = './logs/magnific_requests.log';
    this.retryQueue = [];
  }

  async process(params) {
    const {
      feature = 'upscale', // upscale | enhance | relight | sharpen
      imageUrl,
      imageFile,
      jobId = uuidv4(),
      options = {}
    } = params;

    const keyObj = magnificKeyManager.getNextKey();
    if (!keyObj) throw new Error('No active Magnific API keys. Please add API keys.');

    const proxyInfo = proxyManager.getAgent();
    const startTime = Date.now();

    this._log('REQUEST', { jobId, feature, keyLabel: keyObj.label });
    this._emitProgress(jobId, 'starting', 0, `Starting ${feature}...`);

    try {
      let result;
      
      switch (feature) {
        case 'upscale':
          result = await this._upscale({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options });
          break;
        case 'enhance':
          result = await this._enhance({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options });
          break;
        case 'relight':
          result = await this._relight({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options });
          break;
        case 'sharpen':
          result = await this._sharpen({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options });
          break;
        default:
          throw new Error(`Unknown feature: ${feature}`);
      }

      const latency = Date.now() - startTime;
      magnificKeyManager.markSuccess(keyObj.id, latency);
      if (proxyInfo) proxyManager.markSuccess(proxyInfo.proxyId);

      await this._saveHistory({ jobId, feature, result, latency, options });
      this._emitProgress(jobId, 'completed', 100, 'Processing complete!');
      this._log('SUCCESS', { jobId, latency, outputUrl: result.outputUrl });

      return { success: true, jobId, ...result };

    } catch (error) {
      const errMsg = error.response?.data?.message || error.response?.data?.error || error.message;
      const status = error.response?.status;

      if (proxyInfo) proxyManager.markError(proxyInfo.proxyId);

      // Handle different error types
      if (status === 401 || status === 403 || errMsg?.toLowerCase().includes('unauthorized') || errMsg?.toLowerCase().includes('invalid')) {
        magnificKeyManager.markError(keyObj.id, errMsg, true);
        this._log('DEAD_KEY', { keyId: keyObj.id, error: errMsg });
        // Auto-retry with next key
        const nextKey = magnificKeyManager.getNextKey();
        if (nextKey && nextKey.id !== keyObj.id) {
          this._log('RETRY', { jobId, reason: 'key_dead', newKey: nextKey.label });
          return this.process(params);
        }
      } else if (status === 429 || errMsg?.includes('quota') || errMsg?.includes('rate limit') || errMsg?.includes('limit exceeded')) {
        magnificKeyManager.markQuotaExhausted(keyObj.id);
        this._log('QUOTA_EXHAUSTED', { keyId: keyObj.id });
        // Auto-switch to next key
        return this.process(params);
      } else if (status >= 500 || errMsg?.includes('timeout') || errMsg?.includes('network')) {
        magnificKeyManager.markError(keyObj.id, errMsg);
        // Retry with proxy rotation
        if (proxyInfo) {
          this._log('RETRY_PROXY', { jobId, reason: 'server_error' });
          return this.process(params);
        }
      } else {
        magnificKeyManager.markError(keyObj.id, errMsg);
      }

      this._emitProgress(jobId, 'failed', 0, errMsg);
      this._log('ERROR', { jobId, error: errMsg, status });
      throw new Error(errMsg);
    }
  }

  async _upscale({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options }) {
    const {
      scale = 2,           // 2x, 4x, 8x
      creativity = 0,      // 0-10
      hdr = 0,             // 0-10
      resemblance = 1,     // 0-1
      fractality = 0,      // 0-10
      engine = 'magnific_sharpy', // magnific_sharpy | magnific_illusio | magnific_sparkle
      prompt = '',
      negativePrompt = ''
    } = options;

    this._emitProgress(jobId, 'processing', 20, 'Uploading image to Magnific...');
    
    const uploadedUrl = await this._uploadImage(keyObj, proxyInfo, imageUrl, imageFile);
    
    this._emitProgress(jobId, 'processing', 40, 'Upscaling with Magnific Ultra...');

    const body = {
      image_url: uploadedUrl,
      scale_factor: scale,
      creativity,
      hdr,
      resemblance,
      fractality,
      engine,
      ...(prompt && { prompt }),
      ...(negativePrompt && { negative_prompt: negativePrompt })
    };

    return await this._submitAndPoll(keyObj, proxyInfo, ENDPOINTS.upscale, body, jobId);
  }

  async _enhance({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options }) {
    const {
      enhanceType = 'realism', // realism | detail | face | texture
      strength = 0.7,
      prompt = '',
      preserveOriginal = true
    } = options;

    this._emitProgress(jobId, 'processing', 20, 'Uploading for enhancement...');
    const uploadedUrl = await this._uploadImage(keyObj, proxyInfo, imageUrl, imageFile);
    
    this._emitProgress(jobId, 'processing', 40, `Enhancing ${enhanceType}...`);

    const body = {
      image_url: uploadedUrl,
      enhance_type: enhanceType,
      strength,
      preserve_original: preserveOriginal,
      ...(prompt && { prompt })
    };

    return await this._submitAndPoll(keyObj, proxyInfo, ENDPOINTS.enhance, body, jobId);
  }

  async _relight({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options }) {
    const {
      lightDirection = 'top',    // top | bottom | left | right | front | back
      lightIntensity = 0.7,
      lightColor = '#ffffff',
      ambientLight = 0.3,
      prompt = ''
    } = options;

    this._emitProgress(jobId, 'processing', 20, 'Uploading for relight...');
    const uploadedUrl = await this._uploadImage(keyObj, proxyInfo, imageUrl, imageFile);
    
    this._emitProgress(jobId, 'processing', 40, 'Applying AI relight...');

    const body = {
      image_url: uploadedUrl,
      light_direction: lightDirection,
      light_intensity: lightIntensity,
      light_color: lightColor,
      ambient_light: ambientLight,
      ...(prompt && { prompt })
    };

    return await this._submitAndPoll(keyObj, proxyInfo, ENDPOINTS.relight, body, jobId);
  }

  async _sharpen({ keyObj, proxyInfo, imageUrl, imageFile, jobId, options }) {
    const {
      sharpenType = 'face',  // face | texture | all
      strength = 0.8,
      skinSmoothing = 0.3,
      detailEnhance = 0.7
    } = options;

    this._emitProgress(jobId, 'processing', 20, 'Uploading for sharpening...');
    const uploadedUrl = await this._uploadImage(keyObj, proxyInfo, imageUrl, imageFile);
    
    this._emitProgress(jobId, 'processing', 40, `Sharpening ${sharpenType}...`);

    const body = {
      image_url: uploadedUrl,
      sharpen_type: sharpenType,
      strength,
      skin_smoothing: skinSmoothing,
      detail_enhance: detailEnhance
    };

    return await this._submitAndPoll(keyObj, proxyInfo, ENDPOINTS.sharpen, body, jobId);
  }

  async _uploadImage(keyObj, proxyInfo, imageUrl, imageFile) {
    // If it's already a URL, return it directly
    if (imageUrl && imageUrl.startsWith('http')) return imageUrl;
    
    // Upload local file
    const form = new FormData();
    if (imageFile) {
      form.append('image', fs.createReadStream(imageFile));
    } else if (imageUrl && imageUrl.startsWith('/')) {
      const localPath = '.' + imageUrl;
      form.append('image', fs.createReadStream(localPath));
    }

    const config = {
      headers: {
        'Authorization': `Bearer ${keyObj.key}`,
        ...form.getHeaders()
      },
      timeout: 60000
    };
    if (proxyInfo?.agent) config.httpsAgent = proxyInfo.agent;

    const res = await axios.post(`${MAGNIFIC_API_URL}${ENDPOINTS.upload}`, form, config);
    return res.data?.url || res.data?.image_url;
  }

  async _submitAndPoll(keyObj, proxyInfo, endpoint, body, jobId) {
    const config = {
      headers: {
        'Authorization': `Bearer ${keyObj.key}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };
    if (proxyInfo?.agent) config.httpsAgent = proxyInfo.agent;

    // Submit task
    const submitRes = await axios.post(`${MAGNIFIC_API_URL}${endpoint}`, body, config);
    const taskId = submitRes.data?.task_id || submitRes.data?.id || submitRes.data?.job_id;
    
    // Some endpoints return result directly
    if (submitRes.data?.output_url || submitRes.data?.result_url || submitRes.data?.url) {
      return {
        outputUrl: submitRes.data.output_url || submitRes.data.result_url || submitRes.data.url,
        taskId: taskId || 'direct'
      };
    }

    if (!taskId) throw new Error('No task ID returned from Magnific');

    this._emitProgress(jobId, 'processing', 60, `Processing task ${taskId}...`);

    // Poll for result
    const maxAttempts = 60; // 5 minutes
    for (let i = 0; i < maxAttempts; i++) {
      await this._sleep(5000);
      const progress = Math.min(60 + (i / maxAttempts) * 35, 95);
      this._emitProgress(jobId, 'processing', progress, `Magnific processing... (${i * 5}s)`);

      const pollConfig = { headers: config.headers, timeout: 15000 };
      if (proxyInfo?.agent) pollConfig.httpsAgent = proxyInfo.agent;

      const res = await axios.get(`${MAGNIFIC_API_URL}${ENDPOINTS.status}/${taskId}`, pollConfig);
      const data = res.data;
      const status = data?.status || data?.state;

      if (status === 'completed' || status === 'success' || status === 'done') {
        const outputUrl = data?.output_url || data?.result_url || data?.url || data?.result?.url;
        if (!outputUrl) throw new Error('No output URL in Magnific response');
        return { outputUrl, taskId };
      } else if (status === 'failed' || status === 'error') {
        throw new Error(data?.error || data?.message || 'Magnific processing failed');
      }
    }
    throw new Error('Magnific processing timeout');
  }

  async _saveHistory(data) {
    try {
      const history = await fs.readJson('./data/history.json').catch(() => []);
      history.unshift({ ...data, createdAt: new Date().toISOString(), type: 'image' });
      if (history.length > 500) history.splice(500);
      await fs.writeJson('./data/history.json', history, { spaces: 2 });
    } catch (e) { console.error('History save error:', e.message); }
  }

  _emitProgress(jobId, status, progress, message) {
    if (global.io) {
      global.io.to(`job_${jobId}`).emit('job_progress', { jobId, status, progress, message, timestamp: Date.now() });
      global.io.emit('job_update', { jobId, status, progress, message });
    }
  }

  _log(type, data) {
    const entry = `[${new Date().toISOString()}] [${type}] ${JSON.stringify(data)}\n`;
    fs.appendFile(this.logFile, entry).catch(() => {});
    if (global.io) global.io.emit('debug_log', { type, data, timestamp: Date.now() });
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = new MagnificService();
