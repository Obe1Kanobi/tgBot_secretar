export const config = {
  port: process.env.PORT || 3000,
  chromiumPath: process.env.CHROME_BIN || '/usr/bin/google-chrome-stable',
  geminiApiKey: process.env.GEMINI_API_KEY,
  recording: {
    outDir: process.env.REC_DIR || '/tmp/recordings',
    maxSeconds: Number(process.env.REC_MAX_SECONDS || 3600)
  },
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  adminChatId: process.env.ADMIN_CHAT_ID,
  webhookUrl: process.env.RENDER_EXTERNAL_URL || 'https://bot-w79g.onrender.com',
  
  // Настройки Битрикс24
  bitrix: {
    // URL вашего Битрикс24 (например: https://your-domain.bitrix24.ru)
    webhookUrl: process.env.BITRIX_WEBHOOK_URL,
    
    // ID пользователя для webhook (можно получить в настройках webhook)
    userId: process.env.BITRIX_USER_ID || '1',
    
    // Ключ webhook (генерируется при создании webhook)
    webhookKey: process.env.BITRIX_WEBHOOK_KEY,
    
    // ID ответственного за лиды (по умолчанию администратор)
    responsibleId: process.env.BITRIX_RESPONSIBLE_ID || '1',
    
    // ID проекта/группы для задач (необязательно)
    projectId: process.env.BITRIX_PROJECT_ID || null
  }
};