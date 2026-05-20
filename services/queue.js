/**
 * ARKX Motion Pro - Job Queue Service
 */
const fs = require('fs-extra');

class QueueService {
  constructor() {
    this.queue = [];
    this.processing = new Map();
    this.maxConcurrent = 3;
    this.running = false;
  }

  start() {
    this.running = true;
    this._process();
    console.log('[Queue] Queue service started');
  }

  add(job) {
    const queueJob = {
      id: job.id,
      type: job.type,
      params: job.params,
      status: 'queued',
      addedAt: new Date().toISOString(),
      position: this.queue.length + 1
    };
    this.queue.push(queueJob);
    this._saveQueue();
    this._emitQueueUpdate();
    return queueJob;
  }

  async _process() {
    while (this.running) {
      if (this.processing.size < this.maxConcurrent && this.queue.length > 0) {
        const job = this.queue.shift();
        this._runJob(job);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  async _runJob(job) {
    this.processing.set(job.id, job);
    job.status = 'processing';
    this._emitQueueUpdate();

    try {
      let result;
      if (job.type === 'kling') {
        result = await require('./klingService').generateVideo(job.params);
      } else if (job.type === 'magnific') {
        result = await require('./magnificService').process(job.params);
      }
      job.status = 'completed';
      job.result = result;
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
    }

    this.processing.delete(job.id);
    this._emitQueueUpdate();
  }

  getStatus() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      jobs: [...this.queue, ...this.processing.values()]
    };
  }

  _saveQueue() {
    fs.writeJson('./data/queue.json', { queue: this.queue.slice(0, 50) }, { spaces: 2 }).catch(() => {});
  }

  _emitQueueUpdate() {
    if (global.io) {
      global.io.emit('queue_update', this.getStatus());
    }
  }
}

module.exports = new QueueService();
