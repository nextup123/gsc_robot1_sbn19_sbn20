import pino from 'pino';

// Single global logger
const logger = pino({
  level: 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

/**
 * Create scoped logger
 * Example:
 * createLogger('services', 'rosController')
 */
export const createLogger = (layer, file) => {
  return logger.child({
    layer,   // controllers / services / utils
    file     // file name
  });
};

export default logger;