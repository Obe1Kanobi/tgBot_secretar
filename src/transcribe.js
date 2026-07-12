import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';
import fs from 'node:fs';

const client = new GoogleGenerativeAI(config.geminiApiKey);

export async function transcribeAudio(filePath, logger) {
  try {
    logger.info({ filePath }, 'Starting audio transcription with Gemini');

    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    // Получаем размер файла
    const stats = fs.statSync(filePath);
    logger.info({ fileSize: stats.size }, 'Audio file size');

    // Читаем аудиофайл
    const audioBuffer = fs.readFileSync(filePath);
    const base64Audio = audioBuffer.toString('base64');

    // Используем Gemini для транскрипции
    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash' 
    });

    const prompt = `
Пожалуйста, транскрибируй этот аудиофайл встречи. 
Верни только текст разговора без дополнительных комментариев.
Если можешь определить говорящих, укажи их как "Говорящий 1:", "Говорящий 2:" и т.д.
Если слышишь имена, используй их вместо "Говорящий X".
    `.trim();

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Audio,
          mimeType: 'audio/wav'
        }
      },
      prompt
    ]);

    const response = await result.response;
    const transcript = response.text();

    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Empty transcript received from Gemini');
    }

    logger.info({ 
      transcriptLength: transcript.length,
      preview: transcript.substring(0, 200) + '...'
    }, 'Transcription completed successfully');

    // Удаляем временный аудиофайл
    try {
      fs.unlinkSync(filePath);
      logger.info({ filePath }, 'Temporary audio file deleted');
    } catch (e) {
      logger.warn({ filePath, error: e.message }, 'Could not delete temporary audio file');
    }

    return transcript;

  } catch (error) {
    logger.error({ 
      error: error.message,
      filePath,
      stack: error.stack 
    }, 'Transcription failed');

    // В случае ошибки возвращаем текст-заглушку для демонстрации
    if (error.message.includes('API key') || error.message.includes('quota')) {
      logger.warn('API issue detected, using demo transcript');
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
