/**
 * ARKX Motion Pro — Universal API Proxy
 * Browser → localhost:3000/proxy/* → Magnific API
 * Solves CORS: browser tidak pernah langsung call external API
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Safe proxy agent creation
function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    return new HttpsProxyAgent(proxyUrl);
  } catch(e) {
    console.warn('[Proxy] Invalid proxy URL:', proxyUrl, e.message);
    return null;
  }
}

// Multer: terima file binary DAN field text besar (base64)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024
  }
});

const IMGBB_BASE = 'https://api.imgbb.com';

// ── Proxy pool — loaded from data/proxies.json ──
let proxyPool = [];
let proxyIndex = 0;

function loadProxies() {
  try {
    const data = fs.readJsonSync('./data/proxies.json');
    proxyPool = Array.isArray(data) ? data.map(p => p.url || p).filter(Boolean) : [];
    console.log(`[Proxy] Loaded ${proxyPool.length} proxies`);
  } catch(e) {
    proxyPool = [];
  }
}

function getNextProxy() {
  loadProxies(); // reload setiap kali untuk dapat update terbaru
  if (!proxyPool.length) return null;
  const proxy = proxyPool[proxyIndex % proxyPool.length];
  proxyIndex++;
  return proxy;
}

// ── Helper: detect key type and get correct header + base URL ──
function getKeyConfig(apiKey) {
  if (apiKey && (apiKey.startsWith('FPSX') || apiKey.startsWith('fpsx'))) {
    return { base: 'https://api.freepik.com', header: 'x-freepik-api-key' };
  }
  return { base: 'https://api.magnific.com', header: 'x-magnific-api-key' };
}

// ── Helper: forward request ke Magnific/Freepik ──
async function forwardToMagnific(method, path_, body, apiKey, res) {
  const { base, header } = getKeyConfig(apiKey);
  const fullUrl = base + path_;
  const proxyUrl = getNextProxy();

  console.log(`[Proxy] ${method} → ${fullUrl} | proxy: ${proxyUrl || 'none'}`);

  try {
    const config = {
      method,
      url: fullUrl,
      headers: {
        [header]: apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 60000,
      validateStatus: () => true
    };

    // Pakai proxy kalau ada
    if (proxyUrl) {
      const agent = createProxyAgent(proxyUrl);
      if (agent) {
        config.httpsAgent = agent;
        config.proxy = false;
      }
    }

    if (body && method !== 'GET') config.data = body;

    const resp = await axios(config);
    console.log(`[Proxy] ${method} ${path_} → HTTP ${resp.status}`);
    res.status(resp.status).json(resp.data);
  } catch (err) {
    const msg = err.message || 'Proxy error';
    console.error('[Proxy] Error:', method, path_, msg);
    res.status(500).json({ error: msg, proxy: true });
  }
}

// ── GET /proxy/test-poll ── Test polling langsung ke Magnific
router.get('/test-poll', async (req, res) => {
  const apiKey = req.headers['x-magnific-api-key'];
  const taskId = req.query.taskId;
  const endpoint = req.query.endpoint || '/v1/ai/mystic';
  if (!apiKey || !taskId) return res.status(400).json({ error: 'Need x-magnific-api-key header and taskId query param' });

  const results = {};
  // Try both base URLs
  for (const base of ['https://api.magnific.com', 'https://api.freepik.com']) {
    const headers = base.includes('freepik')
      ? { 'x-freepik-api-key': apiKey }
      : { 'x-magnific-api-key': apiKey };
    try {
      const r = await axios.get(`${base}${endpoint}/${taskId}`, { headers, timeout: 10000, validateStatus: () => true });
      results[base] = { status: r.status, data: r.data };
    } catch(e) {
      results[base] = { error: e.message };
    }
  }
  res.json(results);
});

// ── POST /proxy/magnific/* ── forward POST ke Magnific
router.post('/magnific/*', async (req, res) => {
  const apiKey = req.headers['x-magnific-api-key'] || req.body?._apiKey;
  if (!apiKey) return res.status(401).json({ error: 'Missing x-magnific-api-key header' });

  const body = { ...req.body };
  delete body._apiKey;

  // Build target path — use req.params[0] which captures everything after /magnific/
  const rawParam = req.params[0] || '';
  const targetPath = rawParam.startsWith('v1/') ? ('/' + rawParam) : ('/v1/' + rawParam);
  console.log(`[Proxy] POST targetPath=${targetPath}`);
  await forwardToMagnific('POST', targetPath, body, apiKey, res);
});

// ── GET /proxy/magnific/* ── forward GET ke Magnific (polling task status)
router.get('/magnific/*', async (req, res) => {
  const apiKey = req.headers['x-magnific-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-magnific-api-key header' });

  // Build target path — use req.params[0] which captures everything after /magnific/
  const rawParam = req.params[0] || '';
  const targetPath = rawParam.startsWith('v1/') ? ('/' + rawParam) : ('/v1/' + rawParam);
  console.log(`[Proxy] GET targetPath=${targetPath}`);
  await forwardToMagnific('GET', targetPath, null, apiKey, res);
});

// ── POST /proxy/imgbb ── upload gambar ke ImgBB
router.post('/imgbb', upload.single('file'), async (req, res) => {
  const imgbbKey = req.body?.key || req.headers['x-imgbb-key'];
  if (!imgbbKey) return res.status(400).json({ error: 'Missing ImgBB API key' });

  try {
    const form = new FormData();
    form.append('key', imgbbKey);
    form.append('expiration', '3600');

    if (req.file) {
      // File binary upload — paling reliable
      form.append('image', req.file.buffer.toString('base64'));
    } else if (req.body && req.body.image) {
      // Base64 string dari body
      const b64 = req.body.image.includes(',')
        ? req.body.image.split(',')[1]
        : req.body.image;
      form.append('image', b64);
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    const resp = await axios.post(`${IMGBB_BASE}/1/upload`, form, {
      headers: form.getHeaders(),
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    res.json(resp.data);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.response?.data?.error || err.message;
    console.error('[Proxy] ImgBB error:', msg, err.response?.status);
    res.status(500).json({ error: msg });
  }
});

// ── POST /proxy/upload-video ── simpan video ke server lokal, return URL
router.post('/upload-video', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = path.extname(req.file.originalname) || '.mp4';
    const filename = uuidv4() + ext;
    const filepath = path.join('./uploads', filename);

    await fs.writeFile(filepath, req.file.buffer);

    // Build public URL — pakai host dari request (paling reliable di Render/Railway)
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = process.env.PUBLIC_URL || `${proto}://${host}`;
    const url = `${baseUrl}/uploads/${filename}`;

    console.log(`[Proxy] Video saved: ${url}`);
    res.json({ success: true, url, filename });
  } catch (err) {
    console.error('[Proxy] Video upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════
// GROQ AI — Prompt Enhancement, Chat, Suggestions, Caption
// ══════════════════════════════════════════════
const GROQ_BASE = 'https://api.groq.com/openai/v1';

async function groqChat(apiKey, messages, model) {
  model = model || 'llama-3.3-70b-versatile';
  const resp = await axios.post(`${GROQ_BASE}/chat/completions`, {
    model,
    messages,
    max_tokens: 1024,
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return resp.data.choices[0].message.content;
}

// ── POST /proxy/groq/enhance ── Enhance prompt untuk video/image generation
router.post('/groq/enhance', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  const { prompt, type } = req.body; // type: 'video' | 'image' | 'motion'
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  try {
    const typeDesc = type === 'video' ? 'AI video generation (cinematic, motion, camera angles, lighting)'
      : type === 'motion' ? 'AI motion control video (character movement, body motion, animation)'
      : type === 'image' ? 'AI image generation (visual details, style, lighting, composition)'
      : 'AI media generation';

    const system = `You are an expert prompt engineer for ${typeDesc}. 
Enhance the user's short prompt into a detailed, vivid, professional prompt.
Rules:
- Keep the original intent and subject
- Add cinematic details, lighting, camera angles, mood, style
- For video: add motion descriptions, camera movement
- For image: add artistic style, color palette, composition
- Max 200 words
- Return ONLY the enhanced prompt, no explanation`;

    const enhanced = await groqChat(apiKey, [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ]);
    res.json({ success: true, enhanced: enhanced.trim() });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[Groq] Enhance error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /proxy/groq/caption ── Auto caption dari URL hasil generate
router.post('/groq/caption', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  const { url, type, originalPrompt } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const system = `You are a creative content writer. Generate a short, engaging social media caption for AI-generated ${type || 'media'}.`;
    const userMsg = `Generate 3 caption options for this AI-generated ${type || 'content'}.
Original prompt used: "${originalPrompt || 'AI generated'}"
Make them engaging, use relevant emojis, suitable for Instagram/TikTok.
Format: 
1. [caption]
2. [caption]  
3. [caption]`;

    const captions = await groqChat(apiKey, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ], 'llama-3.1-8b-instant');
    res.json({ success: true, captions: captions.trim() });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ── POST /proxy/groq/chat ── General chat assistant
router.post('/groq/chat', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  const { messages } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'messages required' });

  try {
    const system = `You are ARKX AI Assistant, an expert helper for the ARKX Motion Pro platform.
You help users with:
- How to write effective prompts for video/image generation
- Which AI model to choose for different use cases
- Tips for Motion Control, Upscale, Relight, Style Transfer
- Troubleshooting generation errors
- Best practices for AI media creation
Be concise, friendly, and practical. Use emojis occasionally.`;

    const fullMessages = [{ role: 'system', content: system }, ...messages];
    const reply = await groqChat(apiKey, fullMessages, 'llama-3.1-8b-instant');
    res.json({ success: true, reply: reply.trim() });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ── POST /proxy/groq/suggest ── Prompt suggestions by category
router.post('/groq/suggest', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  const { category, type } = req.body; // category: 'nature','portrait','action','fantasy', etc

  try {
    const system = `You are a creative prompt generator for AI ${type || 'video'} generation.`;
    const userMsg = `Generate 5 creative, detailed prompts for the category: "${category || 'cinematic'}".
Each prompt should be 1-2 sentences, vivid and specific.
Format as JSON array: ["prompt1","prompt2","prompt3","prompt4","prompt5"]
Return ONLY the JSON array, nothing else.`;

    const result = await groqChat(apiKey, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ], 'llama-3.1-8b-instant');

    // Parse JSON dari response
    const match = result.match(/\[[\s\S]*\]/);
    const suggestions = match ? JSON.parse(match[0]) : [];
    res.json({ success: true, suggestions });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ── POST /proxy/groq/video-script ── Generate video script/storyboard
router.post('/groq/video-script', async (req, res) => {
  const apiKey = req.headers['x-groq-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-groq-api-key header' });
  const { topic, duration, style } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  try {
    const system = `You are an expert AI video director and prompt engineer.`;
    const userMsg = `Create a video generation prompt for:
Topic: ${topic}
Duration: ${duration || '10'} seconds
Style: ${style || 'cinematic'}

Generate:
1. Main video prompt (detailed, cinematic)
2. Negative prompt (what to avoid)
3. Suggested model (Kling 2.6 Pro / Seedance 1.5 / WAN 2.6 / Hailuo 2.3)
4. Suggested aspect ratio (16:9 / 9:16 / 1:1)

Format as JSON:
{
  "prompt": "...",
  "negative": "...", 
  "model": "...",
  "ratio": "..."
}
Return ONLY the JSON.`;

    const result = await groqChat(apiKey, [
      { role: 'system', content: system },
      { role: 'user', content: userMsg }
    ]);

    const match = result.match(/\{[\s\S]*\}/);
    const script = match ? JSON.parse(match[0]) : { prompt: result };
    res.json({ success: true, script });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ══════════════════════════════════════════════
// HUGGINGFACE — Free Image Generation
// ══════════════════════════════════════════════
const HF_BASE = 'https://api-inference.huggingface.co/models';

// ── POST /proxy/hf/generate ── Generate image via HuggingFace
router.post('/hf/generate', async (req, res) => {
  const apiKey = req.headers['x-hf-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-hf-api-key header' });

  const { prompt, model, negative_prompt, width, height } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  // Default model: FLUX.1-schnell (fastest free model)
  const hfModel = model || 'black-forest-labs/FLUX.1-schnell';
  const url = `${HF_BASE}/${hfModel}`;

  console.log(`[HF] POST ${url}`);
  try {
    const payload = { inputs: prompt };
    if (negative_prompt) payload.negative_prompt = negative_prompt;
    if (width && height) payload.parameters = { width, height };

    const resp = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'image/png,image/jpeg,image/*'
      },
      responseType: 'arraybuffer',
      timeout: 120000, // 2 menit
      validateStatus: () => true
    });

    console.log(`[HF] Status: ${resp.status}, Content-Type: ${resp.headers['content-type']}`);

    if (resp.status === 503) {
      // Model loading — return estimated wait time
      let errMsg = 'Model loading, please retry in 20s';
      try {
        const errData = JSON.parse(Buffer.from(resp.data).toString());
        errMsg = errData.error || errMsg;
      } catch(e) {}
      return res.status(503).json({ error: errMsg, loading: true });
    }

    if (resp.status !== 200) {
      let errMsg = 'HuggingFace error ' + resp.status;
      try {
        const errData = JSON.parse(Buffer.from(resp.data).toString());
        errMsg = errData.error || errMsg;
      } catch(e) {}
      return res.status(resp.status).json({ error: errMsg });
    }

    // Convert image buffer to base64 data URL
    const contentType = resp.headers['content-type'] || 'image/png';
    const base64 = Buffer.from(resp.data).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    // Save to uploads folder and return URL
    const ext = contentType.includes('jpeg') ? '.jpg' : '.png';
    const filename = uuidv4() + ext;
    const filepath = path.join('./uploads', filename);
    await fs.writeFile(filepath, resp.data);

    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = process.env.PUBLIC_URL || `${proto}://${host}`;
    const imageUrl = `${baseUrl}/uploads/${filename}`;

    res.json({ success: true, url: imageUrl, dataUrl });
  } catch (err) {
    console.error('[HF] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /proxy/hf/models ── List available free models
router.get('/hf/models', (req, res) => {
  res.json({
    models: [
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell', desc: 'Fastest, free', icon: '⚡' },
      { id: 'black-forest-labs/FLUX.1-dev',     name: 'FLUX.1 Dev',     desc: 'High quality', icon: '🔥' },
      { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL 1.0', desc: 'Classic SD', icon: '🎨' },
      { id: 'runwayml/stable-diffusion-v1-5',   name: 'SD 1.5',         desc: 'Fast & light', icon: '🚀' },
      { id: 'Lykon/dreamshaper-8',               name: 'DreamShaper 8',  desc: 'Artistic',    icon: '✨' },
      { id: 'SG161222/Realistic_Vision_V6.0_B1_noVAE', name: 'Realistic Vision', desc: 'Photorealistic', icon: '📸' }
    ]
  });
});

module.exports = router;
