import express from 'express';
import pino from 'pino';
import { openMeeting } from './browser.js';
import { startPulseRecording, stopRecording } from './recording.js';
import { transcribeAudio } from './transcribe.js';
import { runChecklist } from './gemini.js';
import { sendMessage } from './telegram.js';
import { config } from './config.js';
import { 
  setupMiddleware, 
  setupHealthCheck, 
  setupErrorHandling, 
  setupGracefulShutdown 
} from './middleware.js';
import { bitrixService } from './bitrix.js';

// Logger configuration
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

const app = express();

// Setup middleware (security, CORS, rate limiting, logging)
setupMiddleware(app);

// Healthcheck endpoints
setupHealthCheck(app);

// Endpoint для полного цикла анализа встречи
app.post('/process-meeting', async (req, res) => {
  const { meetingUrl, leadId } = req.body || {};
  
  // Validation
  if (!meetingUrl) {
    logger.warn({ meetingUrl, leadId }, 'Missing meetingUrl in request');
    return res.status(400).json({ 
      error: 'VALIDATION_ERROR',
      message: 'meetingUrl is required',
      required: ['meetingUrl']
    });
  }

  // URL validation
  try {
    new URL(meetingUrl);
  } catch (e) {
    logger.warn({ meetingUrl }, 'Invalid URL format');
    return res.status(400).json({ 
      error: 'INVALID_URL',
      message: 'meetingUrl must be a valid URL'
    });
  }
  
  logger.info({ meetingUrl, leadId }, 'Meeting processing request received');

  let browser, page, rec, audioFile;
  try {
    // Открываем встречу
    ({ browser, page } = await openMeeting({ url: meetingUrl, logger }));

    // Старт записи системного звука
    rec = startPulseRecording({ logger });
    audioFile = rec.outfile;

    // Ждём окончания встречи (максимум 1 час)
    logger.info({ maxSeconds: config.recording.maxSeconds }, 'Waiting for meeting to complete...');
    await page.waitForTimeout(config.recording.maxSeconds * 1000);

    // Останавливаем запись
    const outfile = await stopRecording(rec);
    logger.info({ outfile }, 'Recording saved');

    // Транскрипт через Gemini
    const transcript = await transcribeAudio(outfile, logger);
    logger.info({ transcriptLength: transcript.length }, 'Transcript received');

    // Анализ по чек-листу через Gemini
    const analysisResult = await runChecklist(transcript, logger);
    logger.info({ overallScore: analysisResult.overallScore, category: analysisResult.category }, 'Meeting analysis completed');

    // Обновляем лид в Bitrix24 если указан leadId
    if (leadId && config.bitrix.webhookUrl) {
      try {
        await bitrixService.updateLead(leadId, analysisResult, transcript, meetingUrl, logger);
        logger.info({ leadId }, 'Bitrix lead updated successfully');
      } catch (bitrixError) {
        logger.error({ leadId, error: bitrixError.message }, 'Failed to update Bitrix lead');
        // Не прерываем выполнение, просто логируем ошибку
      }
    }

    // Формируем отчет для отправки админу
    const reportMessage = `
📊 ОТЧЕТ ПО ВСТРЕЧЕ

🔗 Ссылка: ${meetingUrl}
📋 ID лида: ${leadId || 'Не указан'}

📝 Длина транскрипта: ${transcript.length} символов
⭐ Общая оценка: ${analysisResult.overallScore}/100
🏷️ Категория клиента: ${analysisResult.category}

📋 Результаты анализа:
${Object.entries(analysisResult.points || {}).map(([key, value]) => 
  `${key}. ${value.score}/10 - ${value.comment?.substring(0, 50) || 'N/A'}...`
).join('\n')}

💡 Резюме:
${analysisResult.summary || 'Нет резюме'}

🎧 Транскрипт (первые 500 символов):
${transcript.substring(0, 500)}...
    `.trim();

    // Отправляем отчет админу
    if (config.adminChatId) {
      await sendMessage(config.adminChatId, reportMessage);
      logger.info('Report sent to admin via Telegram');
    }

    res.json({
      success: true,
      meetingUrl,
      leadId,
      transcriptLength: transcript.length,
      analysis: {
        overallScore: analysisResult.overallScore,
        category: analysisResult.category,
        summary: analysisResult.summary,
        pointsCount: Object.keys(analysisResult.points || {}).length
      },
      bitrixUpdated: !!(leadId && config.bitrix.webhookUrl)
    });

  } catch (e) {
    logger.error({ 
      err: e.message, 
      stack: e.stack,
      meetingUrl, 
      leadId 
    }, 'Meeting processing failed');
    
    // Отправляем ошибку админу
    if (config.adminChatId) {
      await sendMessage(config.adminChatId, 
        `❌ Ошибка обработки встречи: ${meetingUrl}\nОшибка: ${e.message}`
      );
    }
    
    res.status(500).json({ 
      success: false, 
      error: 'PROCESSING_ERROR',
      message: e.message || 'Internal error',
      meetingUrl,
      leadId
    });
  } finally {
    // Cleanup resources
    try { 
      if (rec && typeof rec.stop === 'function') {
        await rec.stop(); 
      }
    } catch (_) {}
    
    try { if (page) await page.close(); } catch (_) {}
    try { if (browser) await browser.close(); } catch (_) {}
    
    logger.info({ meetingUrl }, 'Meeting processing cleanup completed');
  }
});

// Запускаем сервер с graceful shutdown
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: process.env.NODE_ENV }, 'Server started');
});

// Setup graceful shutdown handlers
setupGracefulShutdown(server);
