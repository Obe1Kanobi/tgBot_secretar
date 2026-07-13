import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

export function startPulseRecording({ logger: externalLogger }) {
  const logger = externalLogger || pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => ({ level: label })
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`
  });
  
  const id = uuidv4();
  const dir = path.resolve(config.recording.outDir);
  
  // Создаем директорию если не существует
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info({ dir }, 'Создана директория для записей');
  }
  
  const outfile = path.join(dir, `${id}.wav`);

  // Сначала проверяем доступные аудио устройства
  logger.info('Проверка доступных аудиоустройств...');
  
  const listDevices = spawn('pactl', ['list', 'short', 'sources'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  listDevices.stdout.on('data', (data) => {
    logger.info({ devices: data.toString() }, 'Доступные источники аудио');
  });

  // Улучшенные параметры для записи системного звука
  const args = [
    '-y', // Перезаписывать файл
    '-f', 'pulse', // Использовать PulseAudio
    '-i', 'default.monitor', // Захватываем системный звук (не микрофон)
    '-ac', '1', // Моно (экономит место)
    '-ar', '16000', // Частота дискретизации 16kHz (достаточно для речи)
    '-acodec', 'pcm_s16le', // Кодек
    '-af', 'highpass=f=200,lowpass=f=4000', // Фильтры для улучшения качества речи
    '-t', config.recording.maxSeconds.toString(), // Максимальная длительность
    outfile
  ];

  logger.info({ args, outfile }, 'Запуск записи FFmpeg...');

  const ff = spawn('ffmpeg', args, { 
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false // Изменено для лучшего контроля процесса
  });

  let isRecording = true;

  ff.stdout.on('data', (data) => {
    logger.debug({ output: data.toString().trim() }, 'FFmpeg stdout');
  });

  ff.stderr.on('data', (data) => {
    const message = data.toString().trim();
    if (message.includes('time=')) {
      logger.debug({ progress: message }, 'Запись прогресса');
    } else if (message.includes('error') || message.includes('Error')) {
      logger.error({ error: message }, 'Ошибка FFmpeg');
    } else {
      logger.debug({ stderr: message }, 'FFmpeg stderr');
    }
  });

  ff.on('error', (error) => {
    logger.error({ error: error.message }, 'Ошибка запуска FFmpeg');
    isRecording = false;
  });

  ff.on('exit', (code, signal) => {
    isRecording = false;
    if (code === 0) {
      logger.info({ outfile, code }, 'Запись успешно завершена');
    } else if (signal) {
      logger.info({ outfile, signal }, 'Запись остановлена по сигналу');
    } else {
      logger.warn({ code, outfile }, 'FFmpeg завершился с ненулевым кодом');
    }
  });

  ff.on('close', (code) => {
    isRecording = false;
    logger.info({ code, outfile }, 'Процесс FFmpeg закрыт');
  });

  logger.info({ outfile, pid: ff.pid }, 'Запись успешно запущена');
  
  return { 
    stop: () => {
      if (ff && !ff.killed && isRecording) {
        logger.info({ pid: ff.pid }, 'Остановка записи...');
        ff.kill('SIGTERM'); // Мягкая остановка
        setTimeout(() => {
          if (!ff.killed && isRecording) {
            logger.warn({ pid: ff.pid }, 'Принудительное завершение процесса FFmpeg');
            ff.kill('SIGKILL');
          }
        }, 5000);
      }
    }, 
    outfile, 
    pid: ff.pid,
    isRecording: () => isRecording
  };
}

export async function stopRecording(rec) {
  if (!rec) {
    return null;
  }

  logger.info({ pid: rec.pid }, 'Остановка записи...');
  
  if (rec.stop && typeof rec.stop === 'function') {
    rec.stop();
  }
  
  // Ждем завершения записи
  let attempts = 0;
  const maxAttempts = 30; // 30 секунд максимум
  
  while (rec.isRecording && rec.isRecording() && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts++;
  }

  if (attempts >= maxAttempts) {
    logger.warn('Таймаут остановки записи, но продолжаем...');
  }

  // Проверяем существование файла
  if (fs.existsSync(rec.outfile)) {
    const stats = fs.statSync(rec.outfile);
    logger.info({
      outfile: rec.outfile,
      size: stats.size,
      duration: `${Math.round(stats.size / 32000)} seconds (estimated)`
    }, 'Файл записи готов');
    
    if (stats.size === 0) {
      logger.error('Файл записи пуст');
      throw new Error('Файл записи пуст');
    }
    
    return rec.outfile;
  } else {
    logger.error({ rec: rec, outfile: rec.outfile }, 'Файл записи не существует');
    throw new Error('Recording file was not created');
  }
}

// Альтернативный метод записи через Web Audio API (для браузера)
export async function startWebAudioRecording(page, logger) {
  try {
    logger.info('Запуск веб-записи аудио...');
    
    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          reject(new Error('getDisplayMedia not supported'));
          return;
        }

        navigator.mediaDevices.getDisplayMedia({ 
          audio: true, 
          video: false 
        }).then(stream => {
          window.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
          });
          
          window.audioChunks = [];
          
          window.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              window.audioChunks.push(event.data);
            }
          };
          
          window.mediaRecorder.start();
          resolve();
        }).catch(reject);
      });
    });
    
    logger.info('Веб-запись аудио запущена');
    return true;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Веб-запись аудио не удалась');
    return false;
  }
}

export async function stopWebAudioRecording(page, logger) {
  try {
    logger.info('Остановка веб-записи аудио...');
    
    const audioData = await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!window.mediaRecorder) {
          resolve(null);
          return;
        }
        
        window.mediaRecorder.onstop = () => {
          const blob = new Blob(window.audioChunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = () => {
            resolve(reader.result);
          };
          reader.readAsDataURL(blob);
        };
        
        window.mediaRecorder.stop();
      });
    });
    
    if (audioData) {
      const base64Data = audioData.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      
      const id = uuidv4();
      const dir = path.resolve(config.recording.outDir);
      const outfile = path.join(dir, `${id}.webm`);
      
      fs.writeFileSync(outfile, buffer);
      logger.info({ outfile, size: buffer.length }, 'Веб-запись аудио сохранена');
      
      return outfile;
    }
    
    return null;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Не удалось остановить веб-запись аудио');
    return null;
  }
}
