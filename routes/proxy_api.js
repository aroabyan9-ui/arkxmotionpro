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

// Multer: terima file binary DAN field text besar (base64)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024,   // 200MB file
    fieldSize: 50 * 1024 * 1024    // 50MB field value (untuk base64)
  }
});

const MAGNIFIC_BASE = 'https://api.magnific.com';
const IMGBB_BASE    = 'https://api.imgbb.com';

// ── Helper: forward request ke Magnific ──
async function forwardToMagnific(method, path_, body, apiKey, res) {
  try {
    const config = {
      method,
      url: MAGNIFIC_BASE + path_,
      headers: {
        'x-magnific-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000,
      validateStatus: () => true // jangan throw untuk status apapun
    };
    if (body && method !== 'GET') config.data = body;

    const resp = await axios(config);
    res.status(resp.status).json(resp.data);
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Proxy error';
    console.error('[Proxy] Error:', msg);
    res.status(500).json({ error: msg, proxy: true });
  }
}

// ── POST /proxy/magnific/* ── forward POST ke Magnific
router.post('/magnific/*', async (req, res) => {
  const apiKey = req.headers['x-magnific-api-key'] || req.body?._apiKey;
  if (!apiKey) return res.status(401).json({ error: 'Missing x-magnific-api-key header' });

  // Hapus _apiKey dari body kalau ada
  const body = { ...req.body };
  delete body._apiKey;

  const targetPath = '/' + req.params[0];
  console.log(`[Proxy] POST ${targetPath}`);
  await forwardToMagnific('POST', targetPath, body, apiKey, res);
});

// ── GET /proxy/magnific/* ── forward GET ke Magnific (polling task status)
router.get('/magnific/*', async (req, res) => {
  const apiKey = req.headers['x-magnific-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'Missing x-magnific-api-key header' });

  const targetPath = '/' + req.params[0];
  console.log(`[Proxy] GET ${targetPath}`);
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

module.exports = router;
