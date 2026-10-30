import express from 'express';
import pino from 'pino';
import { openMeeting } from './browser.js';
import { startPulseRecording, stopRecording } from './recording.js';
import { transcribeAudio } from './transcribe.js';
import { sendMessage } from './telegram.js';
import { config } from './config.js';
import { isBitrixEnabled } from './bitrixMode.js';
import { bitrixService } from './fromBitrix/bitrix.js';
import { runChecklist } from './fromBitrix/salesProccesForBitrix24.js';
import {
  setupMiddleware,
  setupHealthCheck,
  setupErrorHandling,
  setupGracefulShutdown
} from './middleware.js';

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
  const { meetingUrl, chatId, leadId } = req.body || {};
  const bitrixMode = isBitrixEnabled();

  // Куда слать отчёт: чат, из которого пришла команда, либо ADMIN_CHAT_ID из .env
  const reportChatId = chatId || config.adminChatId;
  
  // Validation
  if (!meetingUrl) {
    logger.warn({ meetingUrl, leadId }, 'Отсутствует meetingUrl в запросе');
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
    logger.warn({ meetingUrl: meetingUrl }, 'Неверный формат URL');
    return res.status(400).json({ 
      error: 'INVALID_URL',
      message: 'meetingUrl must be a valid URL'
    });
  }
  
  logger.info({ meetingUrl, leadId, bitrixMode }, 'Получен запрос на обработку встречи');

  let browser, page, rec, audioFile;
  try {
    // Открываем встречу
    ({ browser, page } = await openMeeting({ url: meetingUrl, logger }));

    // Старт записи системного звука
    rec = startPulseRecording({ logger });
    audioFile = rec.outfile;

    // Проверяем, не завершился ли FFmpeg сразу с ошибкой (например, нет аудиоустройств)
    if (rec.hasExited && rec.hasExited()) {
      const exitCode = rec.exitCode();
      logger.error({ exitCode, outfile: rec.outfile }, 'FFmpeg завершился сразу после запуска');
      
      // Если это fallback-режим (заглушка), файл уже создан — продолжаем
      if (rec.isFallback) {
        logger.warn('Используется режим заглушки (тишина), продолжаем обработку');
      } else {
        throw new Error(`FFmpeg exited immediately with code ${exitCode}. No audio device available.`);
      }
    }

    // Ждём окончания встречи (максимум 1 час).
    // Проверяем каждые 5 секунд, не завершился ли FFmpeg раньше времени
    logger.info({ maxSeconds: config.recording.maxSeconds }, 'Ожидание завершения встречи...');
    
    const checkInterval = 5000; // проверка каждые 5 секунд
    const maxWait = config.recording.maxSeconds * 1000;
    let waited = 0;
    
    while (waited < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      waited += checkInterval;
      
      // Если FFmpeg неожиданно завершился — выходим раньше
      if (rec.hasExited && rec.hasExited()) {
        const exitCode = rec.exitCode();
        if (exitCode !== 0 && exitCode !== null) {
          logger.warn({ exitCode, waited }, 'FFmpeg завершился раньше времени');
          break;
        }
      }
    }

    // Останавливаем запись
    const outfile = await stopRecording(rec);
    logger.info({ outfile }, 'Запись сохранена');

    // Транскрипт через Gemini
    const transcript = await transcribeAudio(outfile, logger);
    logger.info({ transcriptLength: transcript.length }, 'Транскрипт получен');

    // Анализ по чек-листу через Gemini — только в режиме Битрикс24
    let analysisResult = null;
    if (bitrixMode) {
      analysisResult = await runChecklist(transcript, logger);
      logger.info(
        { overallScore: analysisResult.overallScore, category: analysisResult.category },
        'Meeting analysis completed'
      );
    } else {
      logger.info('Режим Битрикс24 выключен — анализ по чек-листу пропущен');
    }

    // Обновляем лид в Bitrix24 — только в режиме Битрикс24
    let bitrixUpdated = false;
    if (bitrixMode && leadId && config.bitrix.webhookUrl) {
      try {
        await bitrixService.updateLead(leadId, analysisResult, transcript, meetingUrl, logger);
        bitrixUpdated = true;
        logger.info({ leadId }, 'Bitrix lead updated successfully');
      } catch (bitrixError) {
        logger.error({ leadId, error: bitrixError.message }, 'Failed to update Bitrix lead');
        // Не прерываем выполнение, просто логируем ошибку
      }
    } else if (leadId && !bitrixMode) {
      logger.info({ leadId }, 'leadId передан, но режим Битрикс24 выключен — обновление лида пропущено');
    }

    // Формируем отчет для отправки админу
    let reportMessage;
    if (bitrixMode && analysisResult) {
      reportMessage = `
📊 ОТЧЕТ ПО ВСТРЕЧЕ (режим Битрикс24)

🔗 Ссылка: ${meetingUrl}
⭐ Оценка: ${analysisResult.overallScore}/100
🏷️ Категория клиента: ${analysisResult.category}

💡 Резюме: ${analysisResult.summary}

📝 Транскрипт (первые 700 символов):
${transcript.substring(0, 700)}...
      `.trim();
    } else {
      reportMessage = `
📊 ОТЧЕТ ПО ВСТРЕЧЕ (обычный режим)

🔗 Ссылка: ${meetingUrl}
📝 Длина транскрипта: ${transcript.length} символов

🎧 Транскрипт (первые 700 символов):
${transcript.substring(0, 700)}...
      `.trim();
    }

    // Отправляем отчет в чат, откуда пришла команда (или админу как fallback)
    if (reportChatId) {
      await sendMessage(reportChatId, reportMessage);
      logger.info({ reportChatId: reportChatId }, 'Отчёт отправлен через Telegram');
    }

    res.json({
      success: true,
      meetingUrl,
      leadId: leadId || null,
      transcriptLength: transcript.length,
      mode: bitrixMode ? 'bitrix24' : 'standard',
      ...(analysisResult && {
        analysis: {
          overallScore: analysisResult.overallScore,
          category: analysisResult.category,
          summary: analysisResult.summary,
          pointsCount: Object.keys(analysisResult.points || {}).length
        }
      }),
      bitrixUpdated
    });

  } catch (e) {
    logger.error({
      err: e.message,
      stack: e.stack,
      meetingUrl,
      leadId
    }, 'Ошибка обработки встречи');
    
    // Отправляем ошибку в чат, откуда пришла команда (или админу как fallback)
    if (reportChatId) {
      await sendMessage(reportChatId,
        `❌ Ошибка обработки встречи: ${meetingUrl}\nОшибка: ${e.message}`
      );
    }
    
    res.status(500).json({
      success: false,
      error: 'PROCESSING_ERROR',
      message: e.message || 'Internal error',
      meetingUrl,
      leadId: leadId || null
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
    
    logger.info({ meetingUrl }, 'Очистка после обработки встречи завершена');
  }
});

// Запускаем сервер с graceful shutdown
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: process.env.NODE_ENV }, 'Сервер запущен');
});

// Setup graceful shutdown handlers
setupGracefulShutdown(server);
