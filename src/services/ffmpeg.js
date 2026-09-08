'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const config = require('../../config');
const logger = require('../utils/logger');
const { UserError } = require('../utils/errors');

let cachedPath = null;

function resolvePath() {
  if (cachedPath) return cachedPath;

  if (config.paths.ffmpeg && fs.existsSync(config.paths.ffmpeg)) {
    cachedPath = config.paths.ffmpeg;
    return cachedPath;
  }

  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) {
      cachedPath = staticPath;
      return cachedPath;
    }
  } catch {
    logger.debug('ffmpeg-static не установлен, пробую системный ffmpeg');
  }

  cachedPath = 'ffmpeg';
  return cachedPath;
}

function check() {
  return new Promise((resolve) => {
    const child = spawn(resolvePath(), ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';

    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) resolve(null);
      else resolve(output.split('\n')[0].trim());
    });
  });
}

function buildArgs({ url, headers, seek }) {
  const args = ['-hide_banner', '-loglevel', 'error'];

  if (/^https?:/i.test(url)) {
    const entries = Object.entries(headers ?? {});
    const userAgent = entries.find(([key]) => key.toLowerCase() === 'user-agent');
    const rest = entries.filter(([key]) => key.toLowerCase() !== 'user-agent');

    if (userAgent) args.push('-user_agent', String(userAgent[1]));
    if (rest.length) args.push('-headers', `${rest.map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n`);

    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
  }

  if (seek > 0) args.push('-ss', String(seek));

  args.push('-i', url, '-vn', '-sn', '-dn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
  return args;
}

function createPcmStream({ url, headers = {}, seek = 0 }) {
  if (!url) throw new UserError('Не удалось получить аудиопоток источника.');

  const binary = resolvePath();
  const args = buildArgs({ url, headers, seek });

  let child;
  try {
    child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new UserError('ffmpeg не найден. Установи ffmpeg или укажи путь в `FFMPEG_PATH`.');
  }

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
  });

  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });

  child.stdout.on('error', () => {});

  const handle = {
    process: child,
    stream: child.stdout,
    get stderr() {
      return stderr;
    },
    kill() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      child.stdout.destroy();
    },
    waitForStart(timeoutMs) {
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          child.stdout.off('readable', onReadable);
          child.off('close', onClose);
          child.off('error', onError);
        };

        const onData = (chunk) => {
          cleanup();
          child.stdout.unshift(chunk);
          child.stdout.pause();
          resolve();
        };

        const onReadable = () => {
          if (child.stdout.readableLength > 0) {
            cleanup();
            resolve();
          }
        };

        const onClose = (code) => {
          cleanup();
          const error = new Error(stderr.trim() || `ffmpeg завершился с кодом ${code} без данных`);
          error.stderr = stderr;
          reject(error);
        };

        const onError = (error) => {
          cleanup();
          reject(error);
        };

        const timer = setTimeout(() => {
          cleanup();
          handle.kill();
          reject(new Error('Источник не отдал аудио за отведённое время'));
        }, timeoutMs);

        if (spawnError) {
          onError(spawnError);
          return;
        }

        if (child.stdout.readableLength > 0) {
          cleanup();
          resolve();
          return;
        }

        child.stdout.once('data', onData);
        child.stdout.once('readable', onReadable);
        child.once('close', onClose);
        child.once('error', onError);
      });
    },
  };

  return handle;
}

module.exports = { createPcmStream, check, resolvePath };
