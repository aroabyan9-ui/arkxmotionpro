const express = require('express');
const router = express.Router();

router.post('/webhook', (req, res) => {
  const { getBot } = require('../services/telegram');
  const bot = getBot();
  if (bot) bot.processUpdate(req.body);
  res.sendStatus(200);
});

router.post('/configure', (req, res) => {
  const { token, webhookUrl } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  process.env.TELEGRAM_BOT_TOKEN = token;
  if (webhookUrl) process.env.TELEGRAM_WEBHOOK_URL = webhookUrl;
  require('../services/telegram').init();
  res.json({ success: true, message: 'Telegram bot configured' });
});

module.exports = router;
