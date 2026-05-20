/**
 * ARKX Motion Pro - Smart API Key Manager
 * Auto-rotate, dead key detection, health monitoring
 */
const fs = require('fs-extra');
const axios = require('axios');

class KeyManager {
  constructor(type) {
    this.type = type; // 'kling' or 'magnific'
    this.dataFile = `./data/${type}_keys.json`;
    this.currentIndex = 0;
    this.keys = [];
    this.load();
  }

  load() {
    try {
      this.keys = fs.readJsonSync(this.dataFile) || [];
    } catch {
      this.keys = [];
    }
  }

  save() {
    fs.writeJsonSync(this.dataFile, this.keys, { spaces: 2 });
  }

  addKey(keyValue, label = '') {
    const existing = this.keys.find(k => k.key === keyValue);
    if (existing) return { success: false, message: 'Key already exists' };
    
    const newKey = {
      id: Date.now().toString(),
      key: keyValue,
      label: label || `Key ${this.keys.length + 1}`,
      status: 'active',
      requests: 0,
      errors: 0,
      lastUsed: null,
      lastError: null,
      addedAt: new Date().toISOString(),
      quota: { used: 0, limit: null },
      latency: [],
      avgLatency: 0
    };
    this.keys.push(newKey);
    this.save();
    return { success: true, key: newKey };
  }

  addKeys(keysArray) {
    const results = [];
    for (const k of keysArray) {
      const keyVal = typeof k === 'string' ? k.trim() : k.key?.trim();
      const label = typeof k === 'object' ? k.label : '';
      if (keyVal) results.push(this.addKey(keyVal, label));
    }
    return results;
  }

  removeKey(id) {
    const idx = this.keys.findIndex(k => k.id === id);
    if (idx === -1) return { success: false, message: 'Key not found' };
    this.keys.splice(idx, 1);
    this.save();
    return { success: true };
  }

  getActiveKeys() {
    return this.keys.filter(k => k.status === 'active');
  }

  getNextKey() {
    const active = this.getActiveKeys();
    if (active.length === 0) return null;
    
    // Smart routing: pick key with lowest error rate and recent usage
    const scored = active.map(k => ({
      ...k,
      score: (k.errors / Math.max(k.requests, 1)) * 100 + (k.avgLatency / 1000)
    }));
    scored.sort((a, b) => a.score - b.score);
    return scored[0];
  }

  markSuccess(id, latencyMs) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return;
    key.requests++;
    key.lastUsed = new Date().toISOString();
    key.latency.push(latencyMs);
    if (key.latency.length > 20) key.latency.shift();
    key.avgLatency = key.latency.reduce((a, b) => a + b, 0) / key.latency.length;
    key.quota.used++;
    this.save();
    this._emitStats();
  }

  markError(id, errorMsg, isDead = false) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return;
    key.errors++;
    key.lastError = { message: errorMsg, time: new Date().toISOString() };
    key.requests++;
    
    if (isDead || key.errors >= 5) {
      key.status = 'dead';
      console.log(`[KeyManager] Key ${key.label} marked as DEAD: ${errorMsg}`);
      this._logDead(key, errorMsg);
    }
    this.save();
    this._emitStats();
  }

  markQuotaExhausted(id) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return;
    key.status = 'quota_exhausted';
    key.lastError = { message: 'Quota exhausted', time: new Date().toISOString() };
    console.log(`[KeyManager] Key ${key.label} quota exhausted, switching...`);
    this.save();
    this._emitStats();
  }

  resetKey(id) {
    const key = this.keys.find(k => k.id === id);
    if (!key) return { success: false };
    key.status = 'active';
    key.errors = 0;
    key.lastError = null;
    this.save();
    return { success: true };
  }

  getAllKeys() {
    return this.keys.map(k => ({
      ...k,
      key: this._maskKey(k.key)
    }));
  }

  getKeyRaw(id) {
    return this.keys.find(k => k.id === id);
  }

  _maskKey(key) {
    if (!key || key.length < 8) return '****';
    return key.substring(0, 6) + '****' + key.substring(key.length - 4);
  }

  _logDead(key, reason) {
    const logFile = `./logs/dead_keys_${this.type}.log`;
    const entry = `[${new Date().toISOString()}] DEAD KEY: ${key.label} | Reason: ${reason}\n`;
    fs.appendFileSync(logFile, entry);
  }

  _emitStats() {
    if (global.io) {
      global.io.emit('key_stats', {
        type: this.type,
        total: this.keys.length,
        active: this.getActiveKeys().length,
        dead: this.keys.filter(k => k.status === 'dead').length,
        quota_exhausted: this.keys.filter(k => k.status === 'quota_exhausted').length
      });
    }
  }

  getStats() {
    return {
      total: this.keys.length,
      active: this.getActiveKeys().length,
      dead: this.keys.filter(k => k.status === 'dead').length,
      quota_exhausted: this.keys.filter(k => k.status === 'quota_exhausted').length,
      total_requests: this.keys.reduce((a, k) => a + k.requests, 0),
      total_errors: this.keys.reduce((a, k) => a + k.errors, 0)
    };
  }
}

// Singleton instances
const klingKeyManager = new KeyManager('kling');
const magnificKeyManager = new KeyManager('magnific');

// Load from env on startup
if (process.env.KLING_API_KEYS) {
  process.env.KLING_API_KEYS.split(',').forEach(k => klingKeyManager.addKey(k.trim()));
}
if (process.env.MAGNIFIC_API_KEYS) {
  process.env.MAGNIFIC_API_KEYS.split(',').forEach(k => magnificKeyManager.addKey(k.trim()));
}

module.exports = { klingKeyManager, magnificKeyManager, KeyManager };
