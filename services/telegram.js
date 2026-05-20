/**
 * ARKX Motion Pro - Telegram Bot Integration
 */
const TelegramBot = require('node-telegram-bot-api');
const klingService = require('./klingService');
const magnificService = require('./magnificService');
const { klingKeyManager, magnificKeyManager } = require('./keyManager');

let bot = null;

function init() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('[Telegram] Bot started');

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `🎬 *ARKX Motion Pro Bot*\n\nCommands:\n/generate - Generate video\n/upscale - Upscale image\n/enhance - Enhance image\n/relight - AI Relight\n/sharpen - Sharpen face/texture\n/stats - View statistics\n/keys - Key status`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/stats/, async (msg) => {
    const kling = klingKeyManager.getStats();
    const magnific = magnificKeyManager.getStats();
    bot.sendMessage(msg.chat.id, `📊 *API Key Stats*\n\n*Kling AI:*\n✅ Active: ${kling.active}\n❌ Dead: ${kling.dead}\n📊 Total Requests: ${kling.total_requests}\n\n*Magnific:*\n✅ Active: ${magnific.active}\n❌ Dead: ${magnific.dead}\n📊 Total Requests: ${magnific.total_requests}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/generate (.+)/, async (msg, match) => {
    const prompt = match[1];
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, `🎬 Generating video...\nPrompt: ${prompt}`);
    
    try {
      const result = await klingService.generateVideo({
        model: 'kling-2.6',
        mode: 'text-to-video',
        prompt,
        duration: 5,
        ratio: '16:9'
      });
      
      bot.sendMessage(chatId, `✅ Video generated!\n🎥 [Download Video](${result.videoUrl})`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  });

  // Handle photo uploads for image processing
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const caption = msg.caption || '';
    
    if (caption.startsWith('/upscale') || caption.startsWith('/enhance') || caption.startsWith('/relight') || caption.startsWith('/sharpen')) {
      const feature = caption.split(' ')[0].replace('/', '');
      bot.sendMessage(chatId, `🔄 Processing image with ${feature}...`);
      
      try {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const fileUrl = await bot.getFileLink(fileId);
        
        const result = await magnificService.process({
          feature,
          imageUrl: fileUrl,
          options: {}
        });
        
        bot.sendPhoto(chatId, result.outputUrl, { caption: `✅ ${feature} complete!` });
      } catch (err) {
        bot.sendMessage(chatId, `❌ Error: ${err.message}`);
      }
    }
  });

  return bot;
}

module.exports = { init, getBot: () => bot };
