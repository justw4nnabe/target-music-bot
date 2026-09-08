'use strict';

const config = require('../../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, stream, args) {
  if ((LEVELS[level] ?? 99) > threshold) return;
  stream(`[${stamp()}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
  error: (...args) => emit('error', console.error, args),
  warn: (...args) => emit('warn', console.warn, args),
  info: (...args) => emit('info', console.log, args),
  debug: (...args) => emit('debug', console.log, args),
};
