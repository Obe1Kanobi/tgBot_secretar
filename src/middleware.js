import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { config } from './config.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`
});

/**
 * Middleware для безопасности и производительности
 */
export function setupMiddleware(app) {
  // Helmet для security headers
  if (process.env.HELMET_ENABLED !== 'false') {
    app.use(helmet({
      contentSecurityPolicy: false, // Отключаем для API
      crossOriginEmbedderPolicy: false
    }));
    logger.info('Helmet security middleware enabled');
  }

  // CORS configuration
  const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
    maxAge: 86400
  };
  app.use(cors(corsOptions));
  logger.info({ corsOptions }, 'CORS middleware configured');

  // Rate limiting
  const limiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
  });
  app.use('/api/', limiter);
  logger.info('Rate limiting middleware enabled for /api/ routes');

  // Body parser with size limit
  app.use(express.json({ 
    limit: process.env.MAX_REQUEST_SIZE || '10mb',
    strict: true
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration,
        ip: req.ip
      }, 'Request completed');
    });
    next();
  });
}

/**
 * Health check endpoint с аутентификацией
 */
export function setupHealthCheck(app) {
  app.get('/health', (req, res) => {
    // Опциональная проверка токена
    const healthToken = process.env.HEALTH_CHECK_TOKEN;
    if (healthToken) {
      const providedToken = req.headers['x-health-token'];
      if (providedToken !== healthToken) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
    }

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    });
  });

  // Deep health check
  app.get('/health/deep', async (req, res) => {
    try {
      const checks = {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        env: process.env.NODE_ENV
      };

      // Проверка доступности внешних сервисов может быть добавлена здесь

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checks
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Deep health check failed');
      res.status(503).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  });

  logger.info('Health check endpoints configured');
}

/**
 * Error handling middleware
 */
export function setupErrorHandling(app) {
  // 404 handler
  app.use((req, res) => {
    logger.warn({ url: req.url, method: req.method }, 'Route not found');
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.url} not found`
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    logger.error({
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method
    }, 'Unhandled error');

    const statusCode = err.statusCode || err.status || 500;
    
    res.status(statusCode).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : err.message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
  });

  logger.info('Error handling middleware configured');
}

/**
 * Graceful shutdown handler
 */
export function setupGracefulShutdown(server) {
  const shutdownTimeout = Number(process.env.SHUTDOWN_TIMEOUT) || 30000;

  const shutdown = async (signal) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    
    setTimeout(() => {
      logger.error('Forced shutdown due to timeout');
      process.exit(1);
    }, shutdownTimeout);

    try {
      server.close(async () => {
        logger.info('HTTP server closed');
        
        // Закрытие соединений с БД, очистка ресурсов и т.д.
        // await closeDatabaseConnections();
        // await cleanupResources();
        
        logger.info('All resources cleaned up');
        process.exit(0);
      });
    } catch (error) {
      logger.error({ error: error.message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled rejection');
    process.exit(1);
  });

  logger.info('Graceful shutdown handlers configured');
}
