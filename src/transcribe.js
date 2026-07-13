import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import fs from 'node:fs';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export async function transcribeAudio(filePath, logger) {
  try {
    logger.info({ filePath }, 'Запуск транскрипции аудио через Gemini');

    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    // Получаем размер файла
    const stats = fs.statSync(filePath);
    logger.info({ fileSize: stats.size }, 'Размер аудиофайла');

    // Читаем аудиофайл
    const audioBuffer = fs.readFileSync(filePath);
    const base64Audio = audioBuffer.toString('base64');

    const prompt = `
      Пожалуйста, транскрибируй этот аудиофайл встречи.
      Верни только текст разговора без дополнительных комментариев.
      Если можешь определить говорящих, укажи их как "Говорящий 1:", "Говорящий 2:" и т.д.
      Если слышишь имена, используй их вместо "Говорящий X".
    `.trim();

    const result = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { data: base64Audio, mimeType: 'audio/wav' } },
            { text: prompt }
          ]
        }
      ]
    });

    const transcript = result.text;

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Empty transcript received from Gemini');
    }

    logger.info({
      transcriptLength: transcript.length,
      preview: transcript.substring(0, 200) + '...'
    }, 'Транскрипция успешно завершена');

    // Удаляем временный аудиофайл
    try {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, 'Временный аудиофайл удалён');
    } catch (e) {
      logger.warn({ filePath, error: e.message }, 'Не удалось удалить временный аудиофайл');
    }

    return transcript;

  } catch (error) {
    logger.error({
      error: error.message,
      filePath,
      stack: error.stack
    }, 'Транскрипция не удалась');

    // В случае ошибки возвращаем текст-заглушку для демонстрации
    if (error.message.includes('API key') || error.message.includes('quota')) {
      logger.warn('Обнаружена проблема с API, используется демо-транскрипт');
      return generateDemoTranscript();
    }

    throw new Error(`Transcription error: ${error.message}`);
  }
}

function generateDemoTranscript() {
  // Демо-транскрипт для тестирования
  return `Это текст заглушка. Если пришёл он, значит с транскрипцией аудиофайла встречи,
  что-то пошло не так. Что именно, можно увидеть в логгере Docker`.trim();
}
