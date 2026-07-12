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
    logger.info({ dir }, 'Created recordings directory');
  }
  
  const outfile = path.join(dir, `${id}.wav`);

  // Сначала проверяем доступные аудио устройства
  logger.info('Checking available audio devices...');
  
  const listDevices = spawn('pactl', ['list', 'short', 'sources'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  listDevices.stdout.on('data', (data) => {
    logger.info({ devices: data.toString() }, 'Available audio sources');
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

  logger.info({ args, outfile }, 'Starting FFmpeg recording...');

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
      logger.debug({ progress: message }, 'Recording progress');
    } else if (message.includes('error') || message.includes('Error')) {
      logger.error({ error: message }, 'FFmpeg error');
    } else {
      logger.debug({ stderr: message }, 'FFmpeg stderr');
    }
  });

  ff.on('error', (error) => {
    logger.error({ error: error.message }, 'FFmpeg spawn error');
    isRecording = false;
  });

  ff.on('exit', (code, signal) => {
    isRecording = false;
    if (code === 0) {
      logger.info({ outfile, code }, 'Recording completed successfully');
    } else if (signal) {
      logger.info({ outfile, signal }, 'Recording stopped by signal');
    } else {
      logger.warn({ code, outfile }, 'FFmpeg exited with non-zero code');
    }
  });

  ff.on('close', (code) => {
    isRecording = false;
    logger.info({ code, outfile }, 'FFmpeg process closed');
  });

  logger.info({ outfile, pid: ff.pid }, 'Recording started successfully');
  
  return { 
    stop: () => {
      if (ff && !ff.killed && isRecording) {
        logger.info({ pid: ff.pid }, 'Stopping recording...');
        ff.kill('SIGTERM'); // Мягкая остановка
        setTimeout(() => {
          if (!ff.killed && isRecording) {
            logger.warn({ pid: ff.pid }, 'Force killing FFmpeg process');
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

  logger.info({ pid: rec.pid }, 'Stopping recording...');
  
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
    logger.warn('Recording stop timeout, but continuing...');
  }

  // Проверяем существование файла
  if (fs.existsSync(rec.outfile)) {
    const stats = fs.statSync(rec.outfile);
    logger.info({ 
      outfile: rec.outfile, 
      size: stats.size,
      duration: `${Math.round(stats.size / 32000)} seconds (estimated)`
    }, 'Recording file ready');
    
    if (stats.size === 0) {
      logger.error('Recording file is empty');
      throw new Error('Recording file is empty');
    }
    
    return rec.outfile;
  } else {
    logger.error({ outfile: rec.outfile }, 'Recording file does not exist');
    throw new Error('Recording file was not created');
  }
}

// Альтернативный метод записи через Web Audio API (для браузера)
export async function startWebAudioRecording(page, logger) {
  try {
    logger.info('Starting web audio recording...');
    
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
    
    logger.info('Web audio recording started');
    return true;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Web audio recording failed');
    return false;
  }
}

export async function stopWebAudioRecording(page, logger) {
  try {
    logger.info('Stopping web audio recording...');
    
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
      logger.info({ outfile, size: buffer.length }, 'Web audio recording saved');
      
      return outfile;
    }
    
    return null;
    
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to stop web audio recording');
    return null;
  }
}
