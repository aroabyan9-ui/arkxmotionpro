/**
 * ARKX Motion Pro — Auth Service
 * Login, Register, Admin Approval, Email Notification
 */
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const USERS_FILE = './data/users.json';
const JWT_SECRET = process.env.JWT_SECRET || 'arkx_secret_2024_' + Math.random();
const ADMIN_EMAIL = 'nuallakoko@gmail.com';

// Init users file
if (!fs.existsSync(USERS_FILE)) {
  fs.writeJsonSync(USERS_FILE, [], { spaces: 2 });
}

// Email transporter — pakai Gmail SMTP
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_EMAIL || ADMIN_EMAIL,
      pass: process.env.SMTP_PASS || ''
    }
  });
}

class AuthService {
  loadUsers() {
    try { return fs.readJsonSync(USERS_FILE) || []; } catch { return []; }
  }
  saveUsers(users) {
    fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
  }

  async register(name, email, password) {
    const users = this.loadUsers();
    if (users.find(u => u.email === email.toLowerCase())) {
      return { success: false, message: 'Email sudah terdaftar' };
    }
    const hash = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now().toString(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hash,
      status: 'pending', // pending | approved | rejected
      role: 'user',
      createdAt: new Date().toISOString(),
      approvedAt: null,
      lastLogin: null
    };
    users.push(user);
    this.saveUsers(users);

    // Kirim notif ke admin
    await this.notifyAdmin(user);

    // Kirim konfirmasi ke user
    await this.sendUserConfirmation(user);

    return { success: true, message: 'Registrasi berhasil! Menunggu persetujuan admin.' };
  }

  async login(email, password) {
    const users = this.loadUsers();
    const user = users.find(u => u.email === email.toLowerCase().trim());
    if (!user) return { success: false, message: 'Email tidak ditemukan' };

    const match = await bcrypt.compare(password, user.password);
    if (!match) return { success: false, message: 'Password salah' };

    if (user.status === 'pending') {
      return { success: false, message: 'Akun menunggu persetujuan admin. Cek email kamu.' };
    }
    if (user.status === 'rejected') {
      return { success: false, message: 'Akun kamu ditolak oleh admin.' };
    }

    // Update last login
    user.lastLogin = new Date().toISOString();
    this.saveUsers(users);

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    };
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
  }

  async approveUser(userId, adminToken) {
    const admin = this.verifyToken(adminToken);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };

    const users = this.loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return { success: false, message: 'User tidak ditemukan' };

    user.status = 'approved';
    user.approvedAt = new Date().toISOString();
    this.saveUsers(users);

    // Kirim email ke user bahwa diapprove
    await this.sendApprovalEmail(user, true);

    // Emit realtime ke semua client
    if (global.io) {
      global.io.emit('user_approved', { userId, name: user.name, email: user.email });
    }

    return { success: true, message: `${user.name} diapprove` };
  }

  async rejectUser(userId, adminToken) {
    const admin = this.verifyToken(adminToken);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };

    const users = this.loadUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return { success: false, message: 'User tidak ditemukan' };

    user.status = 'rejected';
    this.saveUsers(users);

    await this.sendApprovalEmail(user, false);

    return { success: true, message: `${user.name} ditolak` };
  }

  getAllUsers(adminToken) {
    const admin = this.verifyToken(adminToken);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };
    const users = this.loadUsers();
    return {
      success: true,
      users: users.map(u => ({
        id: u.id, name: u.name, email: u.email,
        status: u.status, role: u.role,
        createdAt: u.createdAt, lastLogin: u.lastLogin
      })),
      pending: users.filter(u => u.status === 'pending').length
    };
  }

  getPendingCount() {
    return this.loadUsers().filter(u => u.status === 'pending').length;
  }

  // Buat admin pertama kali
  async createAdmin(name, email, password, secretKey) {
    if (secretKey !== (process.env.ADMIN_SECRET || 'ARKX_ADMIN_2024')) {
      return { success: false, message: 'Secret key salah' };
    }
    const users = this.loadUsers();
    if (users.find(u => u.role === 'admin')) {
      return { success: false, message: 'Admin sudah ada' };
    }
    const hash = await bcrypt.hash(password, 10);
    users.push({
      id: Date.now().toString(),
      name, email: email.toLowerCase(),
      password: hash,
      status: 'approved',
      role: 'admin',
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      lastLogin: null
    });
    this.saveUsers(users);
    return { success: true, message: 'Admin berhasil dibuat' };
  }

  // ── EMAIL FUNCTIONS ──
  async notifyAdmin(user) {
    if (!process.env.SMTP_PASS) {
      console.log(`[Auth] New user request: ${user.name} <${user.email}> — Email not configured`);
      return;
    }
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: `"ARKX Motion Pro" <${process.env.SMTP_EMAIL || ADMIN_EMAIL}>`,
        to: ADMIN_EMAIL,
        subject: `🔔 New Access Request — ${user.name}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0f0f1a;color:#f0f0ff;padding:24px;border-radius:12px">
            <h2 style="color:#c084fc;margin-bottom:16px">⚡ ARKX Motion Pro</h2>
            <h3 style="color:#22d3ee">New Access Request</h3>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:8px;color:#a0a0c0">Name</td><td style="padding:8px;font-weight:bold">${user.name}</td></tr>
              <tr><td style="padding:8px;color:#a0a0c0">Email</td><td style="padding:8px">${user.email}</td></tr>
              <tr><td style="padding:8px;color:#a0a0c0">Time</td><td style="padding:8px">${new Date(user.createdAt).toLocaleString('id-ID')}</td></tr>
            </table>
            <div style="display:flex;gap:12px;margin-top:20px">
              <a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}/#admin" 
                 style="background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
                ✅ Buka Admin Panel
              </a>
            </div>
            <p style="color:#606080;font-size:12px;margin-top:16px">Login sebagai admin untuk approve/reject user ini.</p>
          </div>
        `
      });
      console.log(`[Auth] Admin notified for: ${user.email}`);
    } catch (e) {
      console.error('[Auth] Email error:', e.message);
    }
  }

  async sendUserConfirmation(user) {
    if (!process.env.SMTP_PASS) return;
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: `"ARKX Motion Pro" <${process.env.SMTP_EMAIL || ADMIN_EMAIL}>`,
        to: user.email,
        subject: '⏳ Registrasi ARKX Motion Pro — Menunggu Persetujuan',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0f0f1a;color:#f0f0ff;padding:24px;border-radius:12px">
            <h2 style="color:#c084fc">⚡ ARKX Motion Pro</h2>
            <p>Halo <b>${user.name}</b>,</p>
            <p style="color:#a0a0c0">Registrasi kamu berhasil! Akun kamu sedang menunggu persetujuan admin.</p>
            <p style="color:#a0a0c0">Kamu akan mendapat email lagi setelah diapprove.</p>
            <p style="color:#606080;font-size:12px;margin-top:24px">ARKX Motion Pro</p>
          </div>
        `
      });
    } catch (e) {
      console.error('[Auth] User confirmation email error:', e.message);
    }
  }

  async sendApprovalEmail(user, approved) {
    if (!process.env.SMTP_PASS) return;
    try {
      const transporter = getTransporter();
      await transporter.sendMail({
        from: `"ARKX Motion Pro" <${process.env.SMTP_EMAIL || ADMIN_EMAIL}>`,
        to: user.email,
        subject: approved ? '✅ Akses ARKX Motion Pro Disetujui!' : '❌ Akses ARKX Motion Pro Ditolak',
        html: approved ? `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0f0f1a;color:#f0f0ff;padding:24px;border-radius:12px">
            <h2 style="color:#c084fc">⚡ ARKX Motion Pro</h2>
            <h3 style="color:#10b981">✅ Akses Disetujui!</h3>
            <p>Halo <b>${user.name}</b>, akun kamu sudah diapprove!</p>
            <p style="color:#a0a0c0">Kamu sekarang bisa login dan menggunakan semua fitur ARKX Motion Pro.</p>
            <a href="${process.env.PUBLIC_URL || 'http://localhost:3000'}" 
               style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">
              🚀 Buka ARKX Motion Pro
            </a>
          </div>
        ` : `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#0f0f1a;color:#f0f0ff;padding:24px;border-radius:12px">
            <h2 style="color:#c084fc">⚡ ARKX Motion Pro</h2>
            <h3 style="color:#ef4444">❌ Akses Ditolak</h3>
            <p>Halo <b>${user.name}</b>, maaf akses kamu ditolak oleh admin.</p>
          </div>
        `
      });
    } catch (e) {
      console.error('[Auth] Approval email error:', e.message);
    }
  }
}

module.exports = new AuthService();
