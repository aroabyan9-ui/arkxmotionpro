/**
 * ARKX Motion Pro - Proxy Manager
 * Auto-rotate proxies for Magnific API calls
 */
const fs = require('fs-extra');
const { HttpsProxyAgent } = require('https-proxy-agent');

class ProxyManager {
  constructor() {
    this.dataFile = './data/proxies.json';
    this.proxies = [];
    this.currentIndex = 0;
    this.load();
  }

  load() {
    try {
      this.proxies = fs.readJsonSync(this.dataFile) || [];
    } catch {
      this.proxies = [];
    }
    // Load from env — always reload to pick up latest
    if (process.env.PROXY_LIST) {
      const envProxies = process.env.PROXY_LIST.split(',').map(p => p.trim()).filter(Boolean);
      console.log(`[ProxyManager] Loading ${envProxies.length} proxies from PROXY_LIST env`);
      envProxies.forEach(p => {
        if (!this.proxies.find(x => x.url === p)) {
          this.proxies.push({
            id: 'env_' + Buffer.from(p).toString('hex').substring(0, 8),
            url: p,
            label: 'ENV: ' + p.split('@')[1] || p,
            status: 'active',
            requests: 0,
            errors: 0,
            lastUsed: null,
            addedAt: new Date().toISOString()
          });
        }
      });
      console.log(`[ProxyManager] Total proxies: ${this.proxies.length}`);
    } else {
      console.log('[ProxyManager] No PROXY_LIST env var found');
    }
  }

  save() {
    fs.writeJsonSync(this.dataFile, this.proxies, { spaces: 2 });
  }

  addProxy(url, label = '') {
    const existing = this.proxies.find(p => p.url === url);
    if (existing) return { success: false, message: 'Proxy already exists' };
    this.proxies.push({
      id: Date.now().toString(),
      url,
      label: label || url,
      status: 'active',
      requests: 0,
      errors: 0,
      lastUsed: null,
      addedAt: new Date().toISOString()
    });
    this.save();
    return { success: true };
  }

  addProxies(list) {
    return list.map(p => {
      const url = typeof p === 'string' ? p.trim() : p.url?.trim();
      const label = typeof p === 'object' ? p.label : '';
      if (url) return this.addProxy(url, label);
      return { success: false };
    });
  }

  removeProxy(id) {
    const idx = this.proxies.findIndex(p => p.id === id);
    if (idx === -1) return { success: false };
    this.proxies.splice(idx, 1);
    this.save();
    return { success: true };
  }

  getNextProxy() {
    // Reload from env if no env proxies loaded yet
    if (process.env.PROXY_LIST && !this.proxies.find(p => p.id && p.id.startsWith('env_'))) {
      this.load();
    }
    const active = this.proxies.filter(p => p.status === 'active');
    if (active.length === 0) return null;
    const proxy = active[this.currentIndex % active.length];
    this.currentIndex++;
    return proxy;
  }

  getAgent() {
    const proxy = this.getNextProxy();
    if (!proxy) return null;
    try {
      return { agent: new HttpsProxyAgent(proxy.url), proxyId: proxy.id };
    } catch {
      return null;
    }
  }

  markSuccess(id) {
    const p = this.proxies.find(x => x.id === id);
    if (p) { p.requests++; p.lastUsed = new Date().toISOString(); this.save(); }
  }

  markError(id) {
    const p = this.proxies.find(x => x.id === id);
    if (p) {
      p.errors++;
      if (p.errors >= 3) p.status = 'dead';
      this.save();
    }
  }

  getAll() {
    return this.proxies;
  }

  getStats() {
    return {
      total: this.proxies.length,
      active: this.proxies.filter(p => p.status === 'active').length,
      dead: this.proxies.filter(p => p.status === 'dead').length
    };
  }
}

const proxyManager = new ProxyManager();
module.exports = { proxyManager };
