require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs-extra');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories
['./uploads', './data', './logs'].forEach(d => fs.ensureDirSync(d));

// Init data files
const defaults = {
  './data/users.json': [],
  './data/magnific_keys.json': [],
  './data/history.json': [],
  './data/stats.json': { total_requests: 0, total_success: 0, total_failed: 0 },
  './data/proxies.json': [],
  './data/queue.json': []
};
Object.entries(defaults).forEach(([f, v]) => {
  if (!fs.existsSync(f)) fs.writeJsonSync(f, v, { spaces: 2 });
});

global.io = io;

// Routes
app.use('/proxy', require('./routes/proxy_api'));
app.use('/auth',  require('./routes/auth'));
app.use('/api/history', require('./routes/history'));
app.use('/api/stats',   require('./routes/stats'));
app.use('/api/debug',   require('./routes/debug'));

// File upload
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({ url: `${baseUrl}/uploads/${req.file.filename}`, filename: req.file.filename });
});
app.use('/uploads', express.static('./uploads'));

// Socket.IO
io.on('connection', socket => {
  socket.on('subscribe_job', jobId => socket.join(`job_${jobId}`));
  socket.on('disconnect', () => {});
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', name: 'ARKX Motion Pro', version: '1.0.0' }));

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const publicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.PUBLIC_URL || `http://localhost:${PORT}`;

  process.env.PUBLIC_URL = publicUrl;

  console.log(`\n🚀 ARKX Motion Pro`);
  console.log(`🌐 URL     : ${publicUrl}`);
  console.log(`💻 Local   : http://localhost:${PORT}`);
  console.log(`📱 Mobile  : http://${getLocalIP()}:${PORT}\n`);

  // Auto-create admin on startup — always ensure admin exists
  setTimeout(async () => {
    try {
      const authService = require('./services/authService');
      const users = authService.loadUsers();
      if (!users.find(u => u.role === 'admin')) {
        const email = process.env.ADMIN_EMAIL || 'nuallakoko@gmail.com';
        const password = process.env.ADMIN_PASSWORD || 'arkx2024';
        const name = process.env.ADMIN_NAME || 'Admin ARKX';
        const result = await authService.createAdmin(name, email, password, 'ARKX_ADMIN_2024');
        console.log('✅ Admin auto-created:', result.message, '| Email:', email);
      } else {
        console.log('✅ Admin already exists');
      }
    } catch(e) {
      console.error('Admin auto-create error:', e.message);
    }
  }, 2000);

  // Init Telegram bot (silent if no token)
  setTimeout(() => {
    try {
      const telegram = require('./services/telegram');
      telegram.init();
    } catch(e) {
      console.warn('[Telegram] Init skipped:', e.message);
    }
  }, 3000);
});

module.exports = { app, io };
