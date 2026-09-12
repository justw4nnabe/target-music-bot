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

  // On Linux (Railway/Docker), always prefer official system ffmpeg
  if (process.platform === 'linux') {
    if (fs.existsSync('/usr/bin/ffmpeg')) {
      cachedPath = '/usr/bin/ffmpeg';
      return cachedPath;
    }
    cachedPath = 'ffmpeg';
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

const ytdlp = require('./ytdlp');

function buildArgs({ url, headers, seek }) {
  const args = ['-hide_banner', '-loglevel', 'error'];

  if (/^https?:/i.test(url)) {
    const entries = Object.entries(headers ?? {});
    const userAgent = entries.find(([key]) => key.toLowerCase() === 'user-agent');
    const rest = entries.filter(([key]) => key.toLowerCase() !== 'user-agent');

    if (userAgent) args.push('-user_agent', String(userAgent[1]));
    if (rest.length) args.push('-headers', `${rest.map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n`);

    args.push(
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '5xx',
      '-reconnect_delay_max', '5',
      '-rw_timeout', '15000000',
    );
  }

  if (seek > 0) args.push('-ss', String(seek));

  args.push('-i', url, '-vn', '-sn', '-dn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
  return args;
}

async function createPcmStream({ url, headers = {}, seek = 0, isYouTube = false, targetUrl = null }) {
  if (!url && !targetUrl) throw new UserError('Не удалось получить аудиопоток источника.');

  const binary = resolvePath();
  const isYt = Boolean(
    isYouTube ||
    (targetUrl && /youtube\.com|youtu\.be/i.test(targetUrl)) ||
    (url && /youtube\.com|youtu\.be/i.test(url))
  );

  if (isYt) {
    const playTarget = targetUrl || url;
    const { binary: ytBinary, args: ytArgs } = await ytdlp.buildArgs([
      '--no-playlist',
      '-f',
      'ba/b',
      '-o',
      '-',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      playTarget,
    ]);

    let ytChild;
    try {
      ytChild = spawn(ytBinary.command, ytArgs, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new UserError('Не удалось запустить yt-dlp для потокового воспроизведения.');
    }

    const ffArgs = ['-hide_banner', '-loglevel', 'error'];
    if (seek > 0) {
      ffArgs.push('-ss', String(seek));
    }
    ffArgs.push('-i', 'pipe:0', '-vn', '-sn', '-dn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');

    let ffChild;
    try {
      ffChild = spawn(binary, ffArgs, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      if (ytChild) {
        try { ytChild.kill('SIGKILL'); } catch {}
      }
      throw new UserError('ffmpeg не найден. Установи ffmpeg или укажи путь в **FFMPEG_PATH**.');
    }

    ytChild.stdout.pipe(ffChild.stdin);

    ytChild.stdout.on('error', () => {});
    ffChild.stdin.on('error', () => {});
    ffChild.stdout.on('error', () => {});

    let ytStderr = '';
    ytChild.stderr.on('data', (chunk) => {
      ytStderr = `${ytStderr}${chunk.toString('utf8')}`.slice(-4000);
    });

    let ffStderr = '';
    ffChild.stderr.on('data', (chunk) => {
      ffStderr = `${ffStderr}${chunk.toString('utf8')}`.slice(-4000);
    });

    let spawnError = null;
    ytChild.on('error', (err) => { spawnError = spawnError || err; });
    ffChild.on('error', (err) => { spawnError = spawnError || err; });

    const handle = {
      process: ffChild,
      ytProcess: ytChild,
      stream: ffChild.stdout,
      get stderr() {
        return `${ffStderr}\n${ytStderr}`.trim();
      },
      kill() {
        try {
          if (ytChild.exitCode === null && ytChild.signalCode === null) {
            ytChild.kill('SIGKILL');
          }
        } catch {}
        try {
          if (ffChild.exitCode === null && ffChild.signalCode === null) {
            ffChild.kill('SIGKILL');
          }
        } catch {}
        try {
          ffChild.stdout.destroy();
        } catch {}
      },
      waitForStart(timeoutMs) {
        return new Promise((resolve, reject) => {
          let timer = null;
          const cleanup = () => {
            if (timer) clearTimeout(timer);
            ffChild.stdout.off('data', onData);
            ffChild.stdout.off('readable', onReadable);
            ffChild.off('close', onClose);
            ffChild.off('error', onError);
            ytChild.off('close', onYtClose);
            ytChild.off('error', onError);
          };

          const onData = (chunk) => {
            cleanup();
            ffChild.stdout.unshift(chunk);
            ffChild.stdout.pause();
            resolve();
          };

          const onReadable = () => {
            if (ffChild.stdout.readableLength > 0) {
              cleanup();
              resolve();
            }
          };

          const onClose = (code) => {
            cleanup();
            const errText = (ffStderr || ytStderr || '').trim();
            const error = new Error(errText || `ffmpeg завершился с кодом ${code} без данных`);
            error.stderr = errText;
            reject(error);
          };

          const onYtClose = (code) => {
            if (code !== 0 && code !== null) {
              cleanup();
              const errText = ytStderr.trim() || `yt-dlp завершился с кодом ${code}`;
              const error = new Error(errText);
              error.stderr = errText;
              reject(error);
            }
          };

          const onError = (error) => {
            cleanup();
            reject(error);
          };

          timer = setTimeout(() => {
            cleanup();
            handle.kill();
            reject(new Error('Источник не отдал аудио за отведённое время'));
          }, timeoutMs);

          if (spawnError) {
            onError(spawnError);
            return;
          }

          if (ffChild.stdout.readableLength > 0) {
            cleanup();
            resolve();
            return;
          }

          ffChild.stdout.once('data', onData);
          ffChild.stdout.once('readable', onReadable);
          ffChild.once('close', onClose);
          ffChild.once('error', onError);
          ytChild.once('close', onYtClose);
          ytChild.once('error', onError);
        });
      },
    };

    return handle;
  }

  // Direct ffmpeg for non-YouTube sources
  const args = buildArgs({ url, headers, seek });

  let child;
  try {
    child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    throw new UserError('ffmpeg не найден. Установи ffmpeg или укажи путь в **FFMPEG_PATH**.');
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
        let timer = null;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
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

        timer = setTimeout(() => {
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
