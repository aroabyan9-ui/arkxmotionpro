/**
 * ARKX Motion Pro - API Key Health Monitor
 */
const { klingKeyManager, magnificKeyManager } = require('./keyManager');

class KeyMonitor {
  start() {
    // Check key health every 5 minutes
    setInterval(() => this._checkHealth(), 5 * 60 * 1000);
    console.log('[KeyMonitor] Key health monitor started');
  }

  _checkHealth() {
    const klingStats = klingKeyManager.getStats();
    const magnificStats = magnificKeyManager.getStats();

    if (global.io) {
      global.io.emit('health_update', {
        kling: klingStats,
        magnific: magnificStats,
        timestamp: Date.now()
      });
    }

    // Log if no active keys
    if (klingStats.active === 0) {
      console.warn('[KeyMonitor] WARNING: No active Kling API keys!');
    }
    if (magnificStats.active === 0) {
      console.warn('[KeyMonitor] WARNING: No active Magnific API keys!');
    }
  }
}

module.exports = new KeyMonitor();
