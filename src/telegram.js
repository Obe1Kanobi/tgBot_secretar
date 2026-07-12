import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.js';
import axios from 'axios';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

const token = config.telegramBotToken;
let bot;

logger.info({ tokenPresent: !!token }, 'Telegram bot initialization');

if (token) {
  try {
    // Используем polling вместо webhook для простоты (webhook требует HTTPS)
    bot = new TelegramBot(token, { 
      polling: {
        interval: 300,
        autoStart: true,
        params: {
          timeout: 10
        }
      }
    });
    
    logger.info('Telegram bot initialized successfully');
    
    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      logger.info({ chatId }, 'Received /help command');
      bot.sendMessage(chatId, `/start - Начать работу с ботом
        \n/process [ссылка_на_встречу] - Обработать встречу
        \n/help - Получить справку
        \n/test - Простая команда для тестирования`).catch(console.error);
    });

    // Добавить ещё команд
    // Команда старта
    bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      logger.info({ chatId }, 'Received /start command');
      bot.sendMessage(chatId, `🤖 Добро пожаловать в Meeting Bot!
        \n\nДля анализа встречи отправьте:
        \n/process [ссылка_на_встречу]
        \n/help - подробная справка`).catch(console.error);
    });

    // Команда обработки встречи
    // (?:@\S+)? — поддержка вызова в группах через /process@ИмяБота
    bot.onText(/\/process(?:@\S+)?\s+(\S+)\s+(\S+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      
      // Извлекаем и очищаем URL от лишних символов
      let meetingUrl = match[1].replace(/[\[\]]/g, ''); // Удаляем квадратные скобки
      const leadId = match[2].replace(/[\[\]]/g, ''); // Удаляем квадратные скобки
      
      // Проверяем, что URL начинается с http/https
      if (!meetingUrl.startsWith('http')) {
        meetingUrl = 'https://' + meetingUrl;
      }
      
      logger.info({ meetingUrl, leadId, chatId }, 'Processing meeting request from Telegram');
      
      try {
        await bot.sendMessage(chatId, '🚀 Начинаю обработку встречи...');
        
        // Используем внутренний URL для запроса.
        // Передаём chatId, чтобы отчёт пришёл в тот же чат, откуда вызвана команда
        const response = await axios.post(`http://localhost:${config.port}/process-meeting`, {
          meetingUrl,
          leadId,
          chatId
        });
        
        if (response.data.success) {
          await bot.sendMessage(chatId, '✅ Встреча успешно обработана! Отчет выше.');
          logger.info({ chatId, leadId }, 'Meeting processed successfully via Telegram');
        } else {
          await bot.sendMessage(chatId, `❌ Ошибка обработки: ${response.data.error}`);
          logger.warn({ chatId, error: response.data.error }, 'Meeting processing failed');
        }
      } catch (error) {
        logger.error({ chatId, error: error.message }, 'Error processing meeting via Telegram');
        await bot.sendMessage(chatId, `❌ Ошибка: ${error.response?.data?.error || error.message}`);
      }
    });

    // Простая команда для тестирования
    bot.onText(/\/test/, (msg) => {
      const chatId = msg.chat.id;
      logger.info({ chatId }, 'Received /test command');
      bot.sendMessage(chatId, 'Бот работает корректно!').catch(console.error);
    });

    // Обработка ошибок бота
    bot.on('polling_error', (error) => {
      logger.error({ error: error.message }, 'Telegram polling error');
    });
    
    bot.on('webhook_error', (error) => {
      logger.error({ error: error.message }, 'Telegram webhook error');
    });
    
    logger.info('Telegram bot started successfully');

  } catch (error) {
    logger.error({ error: error.message }, 'Failed to initialize Telegram bot');
  }
} else {
  logger.warn('TELEGRAM_BOT_TOKEN not set. Telegram bot will not start.');
}

// Функция для отправки сообщений
export async function sendMessage(chatId, message) {
  if (!bot) {
    logger.warn({ chatId }, 'Bot not initialized, cannot send message');
    return;
  }
  
  try {
    // Разбиваем длинные сообщения на части
    const maxLength = 4096;
    if (message.length > maxLength) {
      for (let i = 0; i < message.length; i += maxLength) {
        await bot.sendMessage(chatId, message.substring(i, i + maxLength));
      }
    } else {
      await bot.sendMessage(chatId, message);
    }
    logger.debug({ chatId, messageLength: message.length }, 'Message sent to Telegram');
  } catch (error) {
    logger.error({ chatId, error: error.message }, 'Error sending message to Telegram');
  }
}

export default bot;
