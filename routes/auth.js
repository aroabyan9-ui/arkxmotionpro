const express = require('express');
const router = express.Router();
const authService = require('../services/authService');

// Register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
  if (password.length < 6) return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
  const result = await authService.register(name, email, password);
  res.json(result);
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'Email dan password wajib diisi' });
  const result = await authService.login(email, password);
  res.json(result);
});

// Verify token
router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ valid: false });
  const user = authService.verifyToken(token);
  res.json({ valid: !!user, user });
});

// Admin: get all users
router.get('/admin/users', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  res.json(authService.getAllUsers(token));
});

// Admin: approve user
router.post('/admin/approve/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  res.json(await authService.approveUser(req.params.id, token));
});

// Admin: reject user
router.post('/admin/reject/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  res.json(await authService.rejectUser(req.params.id, token));
});

// Admin: pending count (untuk badge notif)
router.get('/admin/pending', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const admin = authService.verifyToken(token);
  if (!admin || admin.role !== 'admin') return res.json({ count: 0 });
  res.json({ count: authService.getPendingCount() });
});

// Create admin (first time setup)
router.post('/setup-admin', async (req, res) => {
  const { name, email, password, secretKey } = req.body;
  res.json(await authService.createAdmin(name, email, password, secretKey));
});

module.exports = router;
