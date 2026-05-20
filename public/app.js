/**
 * ARKX Motion Pro - Frontend Application
 */

// State
const state = {
  currentPage: 'video',
  selectedModel: 'kling-2.6',
  selectedMode: 'text-to-video',
  selectedRatio: '16:9',
  selectedFeature: 'upscale',
  selectedMotionModel: 'kling-2.6',
  selectedMotionRatio: '16:9',
  selectedScale: 2,
  selectedLight: 'top',
  uploadedImageUrl: null,
  uploadedMotionImageUrl: null,
  uploadedMotionVideoUrl: null,
  uploadedMagnificUrl: null,
  jobs: {},
  autoScroll: true,
  historyPage: 1,
  historyFilter: 'all'
};

// Socket.IO
const socket = io();

socket.on('connect', () => {
  updateConnStatus(true);
  toast('Connected to ARKX server', 'success');
});

socket.on('disconnect', () => updateConnStatus(false));

socket.on('job_progress', (data) => {
  updateJobProgress(data);
});

socket.on('job_update', (data) => {
  updateJobInList(data);
});

socket.on('job_error', (data) => {
  toast(`Job failed: ${data.error}`, 'error');
  updateJobProgress({ ...data, status: 'failed', progress: 0, message: data.error });
});

socket.on('debug_log', (data) => {
  appendDebugLog(data);
});

socket.on('queue_update', (data) => {
  updateQueueMonitor(data);
});

socket.on('health_update', (data) => {
  updateHealthMonitor(data);
});

socket.on('key_stats', (data) => {
  updateSidebarKeyStatus();
});

// ==================== NAVIGATION ====================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  
  const titles = {
    video: 'Video Generate', motion: 'Motion Control', magnific: 'Magnific AI',
    history: 'History', keys: 'API Keys', proxy: 'Proxy Manager',
    telegram: 'Telegram Bot', debug: 'Debug Console', stats: 'Statistics'
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  state.currentPage = page;

  if (page === 'history') loadHistory();
  if (page === 'keys') loadKeys();
  if (page === 'proxy') loadProxies();
  if (page === 'stats') loadStats();
  if (page === 'debug') loadDebugLogs();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ==================== VIDEO GENERATION ====================
function selectModel(el) {
  document.querySelectorAll('#modelGrid .model-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedModel = el.dataset.model;
}

function selectMode(el) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  state.selectedMode = el.dataset.mode;
  document.getElementById('imageUploadGroup').style.display = 
    state.selectedMode === 'image-to-video' ? 'block' : 'none';
}

function selectRatio(el) {
  document.querySelectorAll('#ratioGrid .ratio-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedRatio = el.dataset.ratio;
}

function updateDuration(el) {
  document.getElementById('durationVal').textContent = el.value;
  document.getElementById('motionStrength').oninput = function() {
    document.getElementById('motionVal').textContent = this.value;
  };
}

document.getElementById('motionStrength').oninput = function() {
  document.getElementById('motionVal').textContent = this.value;
};

document.getElementById('videoPrompt').oninput = function() {
  document.getElementById('promptCount').textContent = this.value.length;
};

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) {
    state.uploadedImageUrl = url;
    showImagePreview('imagePreview', url);
  }
}

async function generateVideo() {
  const prompt = document.getElementById('videoPrompt').value.trim();
  if (!prompt && state.selectedMode === 'text-to-video') {
    toast('Please enter a prompt', 'error'); return;
  }
  if (state.selectedMode === 'image-to-video' && !state.uploadedImageUrl) {
    toast('Please upload a reference image', 'error'); return;
  }

  const jobId = generateJobId();
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

  showProgress('progressArea', 'progressBar', 'progressText', 0, 'Starting generation...');
  document.getElementById('progressJob').textContent = `Job ID: ${jobId}`;
  socket.emit('subscribe_job', jobId);
  addJobToList(jobId, 'processing', 'Starting...');

  const params = {
    jobId,
    model: state.selectedModel,
    mode: state.selectedMode,
    prompt,
    negativePrompt: document.getElementById('negativePrompt').value,
    duration: parseInt(document.getElementById('durationSlider').value),
    ratio: state.selectedRatio,
    quality: document.getElementById('videoQuality').value,
    motionStrength: parseFloat(document.getElementById('motionStrength').value),
    seed: document.getElementById('videoSeed').value || undefined,
    imageUrl: state.uploadedImageUrl
  };

  try {
    const res = await fetch('/api/kling/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toast('Generation started! Waiting for result...', 'success');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    hideProgress('progressArea');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-bolt"></i> Generate Video';
  }
}

function updateJobProgress(data) {
  const { jobId, status, progress, message } = data;
  
  // Update main progress if this is the active job
  if (document.getElementById('progressJob').textContent.includes(jobId)) {
    showProgress('progressArea', 'progressBar', 'progressText', progress, message);
    
    if (status === 'completed' && data.videoUrl) {
      showVideoResult(data.videoUrl);
      hideProgress('progressArea');
      const btn = document.getElementById('generateBtn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bolt"></i> Generate Video';
      toast('Video generated successfully!', 'success');
    } else if (status === 'failed') {
      hideProgress('progressArea');
      const btn = document.getElementById('generateBtn');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-bolt"></i> Generate Video';
      toast(`Generation failed: ${message}`, 'error');
    }
  }

  // Update motion progress
  if (document.getElementById('motionProgressArea').dataset.jobId === jobId) {
    showProgress('motionProgressArea', 'motionProgressBar', 'motionProgressText', progress, message);
    if (status === 'completed' && data.videoUrl) {
      showMotionResult(data.videoUrl);
    }
  }

  // Update magnific progress
  if (document.getElementById('magnificProgressArea').dataset.jobId === jobId) {
    showProgress('magnificProgressArea', 'magnificProgressBar', 'magnificProgressText', progress, message);
    if (status === 'completed' && data.outputUrl) {
      showMagnificResult(data.outputUrl);
    }
  }

  updateJobInList(data);
}

// ==================== MOTION CONTROL ====================
function selectMotionModel(el) {
  el.closest('.model-grid').querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedMotionModel = el.dataset.model;
}

function selectMotionRatio(el) {
  document.querySelectorAll('#motionRatioGrid .ratio-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedMotionRatio = el.dataset.ratio;
}

async function handleMotionImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) {
    state.uploadedMotionImageUrl = url;
    showImagePreview('motionImagePreview', url);
  }
}

async function handleMotionVideo(event) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) {
    state.uploadedMotionVideoUrl = url;
    showVideoPreview('motionVideoPreview', url);
  }
}

async function generateMotion() {
  if (!state.uploadedMotionImageUrl) { toast('Please upload a source image', 'error'); return; }
  if (!state.uploadedMotionVideoUrl) { toast('Please upload a reference video', 'error'); return; }

  const jobId = generateJobId();
  socket.emit('subscribe_job', jobId);
  document.getElementById('motionProgressArea').dataset.jobId = jobId;
  showProgress('motionProgressArea', 'motionProgressBar', 'motionProgressText', 0, 'Starting motion control...');

  const params = {
    jobId,
    model: state.selectedMotionModel,
    mode: 'motion-control',
    prompt: document.getElementById('motionPrompt').value,
    imageUrl: state.uploadedMotionImageUrl,
    referenceVideoUrl: state.uploadedMotionVideoUrl,
    duration: parseInt(document.getElementById('motionDuration').value),
    ratio: state.selectedMotionRatio
  };

  try {
    const res = await fetch('/api/kling/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toast('Motion control started!', 'success');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    hideProgress('motionProgressArea');
  }
}

function showMotionResult(videoUrl) {
  const el = document.getElementById('motionResult');
  el.innerHTML = `
    <div style="width:100%">
      <video controls autoplay loop style="width:100%;max-height:400px;border-radius:8px">
        <source src="${videoUrl}" type="video/mp4">
      </video>
      <div class="result-actions">
        <a href="${videoUrl}" download class="btn-primary"><i class="fas fa-download"></i> Download</a>
        <button class="btn-secondary" onclick="copyToClipboard('${videoUrl}')"><i class="fas fa-copy"></i> Copy URL</button>
      </div>
    </div>`;
  hideProgress('motionProgressArea');
}

// ==================== MAGNIFIC AI ====================
function selectFeature(el) {
  document.querySelectorAll('.feature-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  state.selectedFeature = el.dataset.feature;
  
  document.querySelectorAll('.feature-options').forEach(o => o.style.display = 'none');
  document.getElementById(`${state.selectedFeature}Options`).style.display = 'block';
}

function selectScale(el) {
  document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedScale = parseInt(el.dataset.scale);
}

function selectLight(el) {
  document.querySelectorAll('.light-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  state.selectedLight = el.dataset.dir;
}

async function handleMagnificUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) {
    state.uploadedMagnificUrl = url;
    showImagePreview('magnificPreview', url);
    document.getElementById('compareOriginal').src = url;
  }
}

async function processMagnific() {
  if (!state.uploadedMagnificUrl) { toast('Please upload an image', 'error'); return; }

  const jobId = generateJobId();
  socket.emit('subscribe_job', jobId);
  document.getElementById('magnificProgressArea').dataset.jobId = jobId;
  showProgress('magnificProgressArea', 'magnificProgressBar', 'magnificProgressText', 0, 'Starting...');

  let options = {};
  const feature = state.selectedFeature;

  if (feature === 'upscale') {
    options = {
      scale: state.selectedScale,
      engine: document.getElementById('upscaleEngine').value,
      creativity: parseInt(document.getElementById('creativity').value),
      hdr: parseInt(document.getElementById('hdr').value),
      resemblance: parseFloat(document.getElementById('resemblance').value),
      prompt: document.getElementById('upscalePrompt').value
    };
  } else if (feature === 'enhance') {
    options = {
      enhanceType: document.getElementById('enhanceType').value,
      strength: parseFloat(document.getElementById('enhanceStrength').value)
    };
  } else if (feature === 'relight') {
    options = {
      lightDirection: state.selectedLight,
      lightIntensity: parseFloat(document.getElementById('lightIntensity').value),
      lightColor: document.getElementById('lightColor').value
    };
  } else if (feature === 'sharpen') {
    options = {
      sharpenType: document.getElementById('sharpenType').value,
      strength: parseFloat(document.getElementById('sharpenStrength').value),
      skinSmoothing: parseFloat(document.getElementById('skinSmoothing').value),
      detailEnhance: parseFloat(document.getElementById('detailEnhance').value)
    };
  }

  try {
    const res = await fetch('/api/magnific/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, imageUrl: state.uploadedMagnificUrl, options, jobId })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toast('Magnific processing started!', 'success');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    hideProgress('magnificProgressArea');
  }
}

function showMagnificResult(outputUrl) {
  const el = document.getElementById('magnificResult');
  el.innerHTML = `
    <div style="width:100%">
      <img src="${outputUrl}" style="width:100%;border-radius:8px" alt="Enhanced">
      <div class="result-actions" style="margin-top:8px">
        <a href="${outputUrl}" download class="btn-primary"><i class="fas fa-download"></i> Download</a>
        <button class="btn-secondary" onclick="copyToClipboard('${outputUrl}')"><i class="fas fa-copy"></i> Copy URL</button>
      </div>
    </div>`;
  
  // Show compare view
  document.getElementById('compareResult').src = outputUrl;
  document.getElementById('magnificCompare').style.display = 'grid';
  hideProgress('magnificProgressArea');
  toast('Image processed successfully!', 'success');
}

// ==================== API KEYS ====================
async function loadKeys() {
  await Promise.all([loadKeyType('kling'), loadKeyType('magnific')]);
}

async function loadKeyType(type) {
  try {
    const res = await fetch(`/api/keys/${type}`);
    const data = await res.json();
    renderKeys(type, data.keys, data.stats);
  } catch (err) {
    console.error('Load keys error:', err);
  }
}

function renderKeys(type, keys, stats) {
  const statsEl = document.getElementById(`${type}KeyStats`);
  if (statsEl && stats) {
    statsEl.innerHTML = `
      <span class="key-stat-item" style="color:var(--success)"><i class="fas fa-circle" style="font-size:8px"></i> ${stats.active} active</span>
      <span class="key-stat-item" style="color:var(--danger)"><i class="fas fa-circle" style="font-size:8px"></i> ${stats.dead} dead</span>
      <span class="key-stat-item" style="color:var(--warning)"><i class="fas fa-circle" style="font-size:8px"></i> ${stats.quota_exhausted} quota</span>`;
  }

  const listEl = document.getElementById(`${type}KeysList`);
  if (!listEl) return;

  if (!keys || keys.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No keys added yet</div>';
    return;
  }

  listEl.innerHTML = keys.map(k => `
    <div class="key-item ${k.status}" id="key-${k.id}">
      <div class="status-dot ${k.status === 'active' ? 'active' : k.status === 'dead' ? 'error' : 'warning'}"></div>
      <div class="key-info">
        <div class="key-label">${escHtml(k.label)}</div>
        <div class="key-value">${escHtml(k.key)}</div>
        <div class="key-meta">Requests: ${k.requests} | Errors: ${k.errors} | Avg: ${Math.round(k.avgLatency)}ms</div>
      </div>
      <span class="key-badge ${k.status}">${k.status}</span>
      <div class="key-actions">
        ${k.status !== 'active' ? `<button class="btn-sm" onclick="resetKey('${type}','${k.id}')"><i class="fas fa-rotate"></i></button>` : ''}
        <button class="btn-sm btn-danger" onclick="removeKey('${type}','${k.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

async function addKey(type) {
  const keyInput = document.getElementById(`${type}KeyInput`);
  const labelInput = document.getElementById(`${type}KeyLabel`);
  const key = keyInput.value.trim();
  if (!key) { toast('Please enter an API key', 'error'); return; }

  try {
    const res = await fetch(`/api/keys/${type}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, label: labelInput.value.trim() })
    });
    const data = await res.json();
    if (data.success) {
      toast('Key added successfully', 'success');
      keyInput.value = ''; labelInput.value = '';
      loadKeyType(type);
    } else {
      toast(data.message || 'Failed to add key', 'error');
    }
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

function showBulkAdd(type) {
  const area = document.getElementById(`${type}BulkArea`);
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

async function addBulkKeys(type) {
  const textarea = document.getElementById(`${type}BulkInput`);
  const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('No keys entered', 'error'); return; }

  try {
    const res = await fetch(`/api/keys/${type}/add-bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: lines })
    });
    const data = await res.json();
    toast(`Added ${data.added} keys (${lines.length - data.added} duplicates)`, 'success');
    textarea.value = '';
    document.getElementById(`${type}BulkArea`).style.display = 'none';
    loadKeyType(type);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function uploadKeys(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);

  try {
    const res = await fetch(`/api/keys/${type}/upload`, { method: 'POST', body: form });
    const data = await res.json();
    toast(`Uploaded: ${data.added} keys added, ${data.duplicates} duplicates`, 'success');
    loadKeyType(type);
  } catch (err) {
    toast(`Upload error: ${err.message}`, 'error');
  }
}

async function removeKey(type, id) {
  if (!confirm('Remove this API key?')) return;
  try {
    const res = await fetch(`/api/keys/${type}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('Key removed', 'success'); loadKeyType(type); }
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function resetKey(type, id) {
  try {
    const res = await fetch(`/api/keys/${type}/${id}/reset`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('Key reactivated', 'success'); loadKeyType(type); }
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// ==================== PROXY ====================
async function loadProxies() {
  try {
    const res = await fetch('/api/proxy');
    const data = await res.json();
    renderProxies(data.proxies);
  } catch (err) { console.error(err); }
}

function renderProxies(proxies) {
  const el = document.getElementById('proxyList');
  if (!proxies || !proxies.length) {
    el.innerHTML = '<div class="empty-state">No proxies added</div>'; return;
  }
  el.innerHTML = proxies.map(p => `
    <div class="key-item ${p.status}">
      <div class="status-dot ${p.status === 'active' ? 'active' : 'error'}"></div>
      <div class="key-info">
        <div class="key-label">${escHtml(p.label)}</div>
        <div class="key-value">${escHtml(p.url)}</div>
        <div class="key-meta">Requests: ${p.requests} | Errors: ${p.errors}</div>
      </div>
      <span class="key-badge ${p.status}">${p.status}</span>
      <button class="btn-sm btn-danger" onclick="removeProxy('${p.id}')"><i class="fas fa-trash"></i></button>
    </div>`).join('');
}

async function addProxy() {
  const url = document.getElementById('proxyInput').value.trim();
  const label = document.getElementById('proxyLabel').value.trim();
  if (!url) { toast('Please enter proxy URL', 'error'); return; }
  try {
    const res = await fetch('/api/proxy/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, label })
    });
    const data = await res.json();
    if (data.success) { toast('Proxy added', 'success'); document.getElementById('proxyInput').value = ''; loadProxies(); }
    else toast(data.message, 'error');
  } catch (err) { toast(err.message, 'error'); }
}

async function addBulkProxies() {
  const lines = document.getElementById('proxyBulkInput').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast('No proxies entered', 'error'); return; }
  try {
    const res = await fetch('/api/proxy/add-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxies: lines })
    });
    const data = await res.json();
    toast(`Added ${data.results.filter(r => r.success).length} proxies`, 'success');
    document.getElementById('proxyBulkInput').value = '';
    document.getElementById('proxyBulkArea').style.display = 'none';
    loadProxies();
  } catch (err) { toast(err.message, 'error'); }
}

async function uploadProxies(event) {
  const file = event.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/proxy/upload', { method: 'POST', body: form });
    const data = await res.json();
    toast(`Added ${data.added} proxies`, 'success');
    loadProxies();
  } catch (err) { toast(err.message, 'error'); }
}

async function removeProxy(id) {
  if (!confirm('Remove this proxy?')) return;
  try {
    await fetch(`/api/proxy/${id}`, { method: 'DELETE' });
    toast('Proxy removed', 'success');
    loadProxies();
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== HISTORY ====================
async function loadHistory() {
  const el = document.getElementById('historyGrid');
  el.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
  try {
    const res = await fetch(`/api/history?page=${state.historyPage}&limit=20&type=${state.historyFilter === 'all' ? '' : state.historyFilter}`);
    const data = await res.json();
    renderHistory(data.history, data.total, data.page, data.limit);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">Error loading history: ${err.message}</div>`;
  }
}

function renderHistory(items, total, page, limit) {
  const el = document.getElementById('historyGrid');
  if (!items || !items.length) {
    el.innerHTML = '<div class="empty-state">No history yet. Generate something!</div>'; return;
  }
  el.innerHTML = items.map(item => {
    const isVideo = item.type === 'video';
    const thumb = isVideo ? (item.result?.thumbnailUrl || '') : (item.result?.outputUrl || '');
    const url = isVideo ? item.result?.videoUrl : item.result?.outputUrl;
    return `
      <div class="history-item" onclick="openHistoryItem('${escHtml(JSON.stringify(item).replace(/'/g, "\\'"))}')">
        ${isVideo 
          ? `<video class="history-thumb-video" src="${url || ''}" muted></video>`
          : `<img class="history-thumb" src="${thumb || url || ''}" alt="result" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\'><rect width=\\'200\\' height=\\'120\\' fill=\\'%23111\\'/></svg>'">`
        }
        <div class="history-info">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span class="history-type-badge ${item.type}">${item.type}</span>
            <span class="history-model">${item.model || item.feature || ''}</span>
          </div>
          <div class="history-prompt">${escHtml(item.prompt || item.feature || 'No prompt')}</div>
          <div class="history-date">${formatDate(item.createdAt)}</div>
        </div>
      </div>`;
  }).join('');

  // Pagination
  const totalPages = Math.ceil(total / limit);
  const pagEl = document.getElementById('historyPagination');
  if (totalPages > 1) {
    let btns = '';
    for (let i = 1; i <= Math.min(totalPages, 10); i++) {
      btns += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goHistoryPage(${i})">${i}</button>`;
    }
    pagEl.innerHTML = btns;
  } else {
    pagEl.innerHTML = '';
  }
}

function filterHistory(el) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  state.historyFilter = el.dataset.filter;
  state.historyPage = 1;
  loadHistory();
}

function goHistoryPage(page) {
  state.historyPage = page;
  loadHistory();
}

async function clearHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  try {
    await fetch('/api/history', { method: 'DELETE' });
    toast('History cleared', 'success');
    loadHistory();
  } catch (err) { toast(err.message, 'error'); }
}

function openHistoryItem(itemJson) {
  try {
    const item = JSON.parse(itemJson);
    const isVideo = item.type === 'video';
    const url = isVideo ? item.result?.videoUrl : item.result?.outputUrl;
    
    document.getElementById('modalContent').innerHTML = `
      <div style="max-width:600px">
        <h3 style="margin-bottom:16px;color:var(--accent-light)">${isVideo ? '🎬 Video' : '🖼️ Image'} Result</h3>
        ${isVideo 
          ? `<video controls style="width:100%;border-radius:8px;margin-bottom:12px"><source src="${url}" type="video/mp4"></video>`
          : `<img src="${url}" style="width:100%;border-radius:8px;margin-bottom:12px" alt="result">`
        }
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
          <div><strong>Model:</strong> ${item.model || item.feature}</div>
          <div><strong>Prompt:</strong> ${escHtml(item.prompt || 'N/A')}</div>
          <div><strong>Date:</strong> ${formatDate(item.createdAt)}</div>
          ${item.duration ? `<div><strong>Duration:</strong> ${item.duration}s</div>` : ''}
          ${item.latency ? `<div><strong>Generation time:</strong> ${(item.latency/1000).toFixed(1)}s</div>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <a href="${url}" download class="btn-primary"><i class="fas fa-download"></i> Download</a>
          <button class="btn-secondary" onclick="copyToClipboard('${url}')"><i class="fas fa-copy"></i> Copy URL</button>
          <button class="btn-secondary" onclick="closeModal()">Close</button>
        </div>
      </div>`;
    document.getElementById('modal').style.display = 'flex';
  } catch (e) { console.error(e); }
}

// ==================== STATS ====================
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    renderStats(data);
  } catch (err) { console.error(err); }
}

function renderStats(data) {
  const el = document.getElementById('statsGrid');
  const stats = [
    { icon: '🎬', value: data.history?.videos || 0, label: 'Videos Generated' },
    { icon: '🖼️', value: data.history?.images || 0, label: 'Images Processed' },
    { icon: '📅', value: data.history?.today || 0, label: 'Today\'s Generations' },
    { icon: '🔑', value: data.kling?.active || 0, label: 'Active Kling Keys' },
    { icon: '✨', value: data.magnific?.active || 0, label: 'Active Magnific Keys' },
    { icon: '❌', value: (data.kling?.dead || 0) + (data.magnific?.dead || 0), label: 'Dead Keys' },
    { icon: '📊', value: (data.kling?.total_requests || 0) + (data.magnific?.total_requests || 0), label: 'Total API Requests' },
    { icon: '🛡️', value: data.proxy?.active || 0, label: 'Active Proxies' }
  ];
  el.innerHTML = stats.map(s => `
    <div class="stat-card">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.value.toLocaleString()}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// ==================== TELEGRAM ====================
async function configureTelegram() {
  const token = document.getElementById('telegramToken').value.trim();
  const webhookUrl = document.getElementById('telegramWebhook').value.trim();
  if (!token) { toast('Please enter bot token', 'error'); return; }
  try {
    const res = await fetch('/api/telegram/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, webhookUrl })
    });
    const data = await res.json();
    if (data.success) toast('Telegram bot connected!', 'success');
    else toast(data.error, 'error');
  } catch (err) { toast(err.message, 'error'); }
}

// ==================== DEBUG ====================
async function loadDebugLogs() {
  try {
    const [klingRes, magnificRes] = await Promise.all([
      fetch('/api/debug/logs/kling'),
      fetch('/api/debug/logs/magnific')
    ]);
    const klingData = await klingRes.json();
    const magnificData = await magnificRes.json();
    
    const console_ = document.getElementById('debugConsole');
    const allLogs = [...(klingData.logs || []), ...(magnificData.logs || [])].sort();
    
    console_.innerHTML = allLogs.map(line => {
      const match = line.match(/\[([^\]]+)\] \[([^\]]+)\] (.*)/);
      if (match) {
        return `<div class="debug-line ${match[2]}">
          <span class="debug-timestamp">${match[1].substring(11, 19)}</span>
          <span class="debug-type">[${match[2]}]</span>
          <span>${escHtml(match[3])}</span>
        </div>`;
      }
      return `<div class="debug-line INFO">${escHtml(line)}</div>`;
    }).join('');
    
    if (state.autoScroll) console_.scrollTop = console_.scrollHeight;
    
    // Load health
    const healthRes = await fetch('/api/debug/health');
    const health = await healthRes.json();
    renderHealthMonitor(health);
  } catch (err) { console.error(err); }
}

function appendDebugLog(data) {
  if (state.currentPage !== 'debug') return;
  const console_ = document.getElementById('debugConsole');
  const line = document.createElement('div');
  line.className = `debug-line ${data.type}`;
  line.innerHTML = `<span class="debug-timestamp">${new Date().toTimeString().substring(0,8)}</span><span class="debug-type">[${data.type}]</span><span>${escHtml(JSON.stringify(data.data))}</span>`;
  console_.appendChild(line);
  if (state.autoScroll) console_.scrollTop = console_.scrollHeight;
  // Keep max 500 lines
  while (console_.children.length > 500) console_.removeChild(console_.firstChild);
}

function clearDebugLog() {
  document.getElementById('debugConsole').innerHTML = '';
}

function toggleAutoScroll() {
  state.autoScroll = !state.autoScroll;
  toast(`Auto-scroll ${state.autoScroll ? 'enabled' : 'disabled'}`, 'success');
}

function renderHealthMonitor(health) {
  const el = document.getElementById('healthGrid');
  if (!el) return;
  el.innerHTML = `
    <div class="health-item">
      <div class="status-dot ${health.kling_keys?.active > 0 ? 'active' : 'error'}"></div>
      <div class="health-name">Kling AI Keys</div>
      <div class="health-value">${health.kling_keys?.active || 0} active / ${health.kling_keys?.total || 0} total</div>
    </div>
    <div class="health-item">
      <div class="status-dot ${health.magnific_keys?.active > 0 ? 'active' : 'error'}"></div>
      <div class="health-name">Magnific Keys</div>
      <div class="health-value">${health.magnific_keys?.active || 0} active / ${health.magnific_keys?.total || 0} total</div>
    </div>
    <div class="health-item">
      <div class="status-dot ${health.proxies?.active > 0 ? 'active' : 'warning'}"></div>
      <div class="health-name">Proxies</div>
      <div class="health-value">${health.proxies?.active || 0} active / ${health.proxies?.total || 0} total</div>
    </div>
    <div class="health-item">
      <div class="status-dot active"></div>
      <div class="health-name">Server Uptime</div>
      <div class="health-value">${formatUptime(health.uptime)}</div>
    </div>`;
}

function updateQueueMonitor(data) {
  document.getElementById('queuedCount').textContent = data.queued || 0;
  document.getElementById('processingCount').textContent = data.processing || 0;
  
  const badge = document.getElementById('queueBadge');
  const total = (data.queued || 0) + (data.processing || 0);
  if (total > 0) {
    badge.style.display = 'flex';
    document.getElementById('queueCount').textContent = total;
  } else {
    badge.style.display = 'none';
  }
}

function updateHealthMonitor(data) {
  updateSidebarKeyStatus(data);
}

function updateSidebarKeyStatus(data) {
  const dot = document.querySelector('#sidebarKeyStatus .status-dot');
  const text = document.querySelector('#sidebarKeyStatus span');
  if (!dot) return;
  
  fetch('/api/stats').then(r => r.json()).then(stats => {
    const totalActive = (stats.kling?.active || 0) + (stats.magnific?.active || 0);
    if (totalActive > 0) {
      dot.className = 'status-dot active';
      text.textContent = `${totalActive} Keys Active`;
    } else {
      dot.className = 'status-dot error';
      text.textContent = 'No Active Keys';
    }
  }).catch(() => {});
}

// ==================== UTILITIES ====================
async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (data.url) return data.url;
    throw new Error(data.error || 'Upload failed');
  } catch (err) {
    toast(`Upload failed: ${err.message}`, 'error');
    return null;
  }
}

function showImagePreview(containerId, url) {
  const el = document.getElementById(containerId);
  el.style.display = 'block';
  el.innerHTML = `<img src="${url}" alt="Preview" style="max-height:200px;width:100%;object-fit:contain">`;
}

function showVideoPreview(containerId, url) {
  const el = document.getElementById(containerId);
  el.style.display = 'block';
  el.innerHTML = `<video src="${url}" controls style="max-height:200px;width:100%;object-fit:contain"></video>`;
}

function showVideoResult(videoUrl) {
  const el = document.getElementById('videoResult');
  el.innerHTML = `
    <div style="width:100%">
      <video controls autoplay loop style="width:100%;max-height:400px;border-radius:8px">
        <source src="${videoUrl}" type="video/mp4">
      </video>
      <div class="result-actions" style="margin-top:8px;display:flex;gap:8px">
        <a href="${videoUrl}" download class="btn-primary"><i class="fas fa-download"></i> Download</a>
        <button class="btn-secondary" onclick="copyToClipboard('${videoUrl}')"><i class="fas fa-copy"></i> Copy URL</button>
      </div>
    </div>`;
}

function showProgress(areaId, barId, textId, progress, message) {
  const area = document.getElementById(areaId);
  area.style.display = 'block';
  document.getElementById(barId).style.width = `${progress}%`;
  document.getElementById(textId).textContent = message;
}

function hideProgress(areaId) {
  document.getElementById(areaId).style.display = 'none';
}

function addJobToList(jobId, status, message) {
  state.jobs[jobId] = { id: jobId, status, message, time: Date.now() };
  renderJobList();
}

function updateJobInList(data) {
  if (state.jobs[data.jobId]) {
    state.jobs[data.jobId] = { ...state.jobs[data.jobId], ...data };
    renderJobList();
  }
}

function renderJobList() {
  const el = document.getElementById('recentJobs');
  const jobs = Object.values(state.jobs).slice(-10).reverse();
  if (!jobs.length) { el.innerHTML = '<p class="empty-state">No jobs yet</p>'; return; }
  el.innerHTML = jobs.map(j => `
    <div class="job-item">
      <div class="job-status ${j.status}"></div>
      <div class="job-info">
        <div class="job-id">${j.id.substring(0, 8)}...</div>
        <div class="job-progress-text">${j.message || j.status}</div>
      </div>
      <span style="font-size:11px;color:var(--text-muted)">${j.progress ? Math.round(j.progress) + '%' : ''}</span>
    </div>`).join('');
}

function generateJobId() {
  return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function updateConnStatus(connected) {
  const el = document.getElementById('connStatus');
  el.innerHTML = connected 
    ? '<div class="status-dot active"></div><span>Connected</span>'
    : '<div class="status-dot error"></div><span>Disconnected</span>';
}

function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fas ${icons[type] || icons.success}"></i><span>${escHtml(message)}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100%)'; t.style.transition = 'all 0.3s'; setTimeout(() => t.remove(), 300); }, 4000);
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'));
}

function escHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatUptime(seconds) {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Drag and drop for upload zones
function setupDragDrop(zoneId, inputId, handler) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file) handler({ target: { files: [file] } });
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop('imageDropZone', 'imageInput', handleImageUpload);
  setupDragDrop('magnificDropZone', 'magnificInput', handleMagnificUpload);
  
  // Load initial stats
  updateSidebarKeyStatus();
  
  // Refresh stats every 30s
  setInterval(updateSidebarKeyStatus, 30000);
  
  // Load debug health every 10s if on debug page
  setInterval(() => {
    if (state.currentPage === 'debug') {
      fetch('/api/debug/health').then(r => r.json()).then(renderHealthMonitor).catch(() => {});
    }
  }, 10000);

  console.log('ARKX Motion Pro initialized');
});
