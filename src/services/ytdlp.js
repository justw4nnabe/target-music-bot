'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../../config');
const logger = require('../utils/logger');
const { UserError } = require('../utils/errors');

const isWindows = process.platform === 'win32';
const BIN_NAME = isWindows ? 'yt-dlp.exe' : 'yt-dlp';

let resolvedBinary = null;
let resolving = null;

function execute(command, args, { timeoutMs = 15000, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Таймаут выполнения: ${command} (${timeoutMs} мс)`));
    }, timeoutMs);

    if (capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');

      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }

      const error = new Error(err.trim() || `Процесс завершился с кодом ${code}`);
      error.stderr = err;
      error.exitCode = code;
      reject(error);
    });
  });
}

async function probe(command, prefixArgs) {
  try {
    const { stdout } = await execute(command, [...prefixArgs, '--version'], { timeoutMs: 12000 });
    return stdout.trim().split('\n').pop().trim();
  } catch {
    return null;
  }
}

async function detectBinary() {
  const candidates = [];

  if (config.paths.ytdlp) candidates.push({ command: config.paths.ytdlp, prefixArgs: [], label: 'YTDLP_PATH' });

  const bundled = path.join(config.paths.binDir, BIN_NAME);
  if (fs.existsSync(bundled)) candidates.push({ command: bundled, prefixArgs: [], label: 'bin/' });

  candidates.push({ command: 'yt-dlp', prefixArgs: [], label: 'PATH' });
  if (isWindows) candidates.push({ command: 'py', prefixArgs: ['-m', 'yt_dlp'], label: 'py -m yt_dlp' });
  candidates.push({ command: 'python', prefixArgs: ['-m', 'yt_dlp'], label: 'python -m yt_dlp' });
  candidates.push({ command: 'python3', prefixArgs: ['-m', 'yt_dlp'], label: 'python3 -m yt_dlp' });

  for (const candidate of candidates) {
    const version = await probe(candidate.command, candidate.prefixArgs);
    if (version) {
      logger.info(`yt-dlp найден (${candidate.label}), версия ${version}`);
      return { ...candidate, version };
    }
  }

  throw new UserError(
    'yt-dlp не найден. Запусти `npm run setup` (скачает бинарник в bin/) или `pip install -U yt-dlp`.',
  );
}

async function getBinary() {
  if (resolvedBinary) return resolvedBinary;
  if (!resolving) {
    resolving = detectBinary()
      .then((result) => {
        resolvedBinary = result;
        return result;
      })
      .catch((error) => {
        resolving = null;
        throw error;
      });
  }
  return resolving;
}

function commonArgs() {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-progress',
    '--no-color',
    '--retries',
    '3',
    '--socket-timeout',
    String(config.ytdlp.socketTimeout),
    '--extractor-args',
    'youtube:player_client=ios,android,mweb',
  ];

  let cookiesFile = config.ytdlp.cookiesFile;
  if (!cookiesFile && process.env.YTDLP_COOKIES_TEXT) {
    const os = require('node:os');
    const tmp = path.join(os.tmpdir(), 'yt_cookies.txt');
    try {
      if (!fs.existsSync(tmp) || fs.readFileSync(tmp, 'utf8') !== process.env.YTDLP_COOKIES_TEXT) {
        fs.writeFileSync(tmp, process.env.YTDLP_COOKIES_TEXT, 'utf8');
      }
      cookiesFile = tmp;
    } catch {}
  }

  if (cookiesFile) args.push('--cookies', cookiesFile);
  else if (config.ytdlp.cookiesFromBrowser) args.push('--cookies-from-browser', config.ytdlp.cookiesFromBrowser);

  return args;
}

async function buildArgs(args) {
  const binary = await getBinary();
  return { binary, args: [...binary.prefixArgs, ...commonArgs(), ...args] };
}

async function runJson(extraArgs) {
  const { binary, args } = await buildArgs([...extraArgs, '--dump-single-json']);
  logger.debug(`yt-dlp ${args.join(' ')}`);

  const { stdout } = await execute(binary.command, args, { timeoutMs: config.ytdlp.timeoutMs });
  const payload = stdout.trim();
  if (!payload) throw new Error('yt-dlp вернул пустой ответ');

  try {
    return JSON.parse(payload);
  } catch {
    const firstLine = payload.split('\n').find((line) => line.trim().startsWith('{'));
    if (!firstLine) throw new Error('Не удалось разобрать ответ yt-dlp');
    return JSON.parse(firstLine);
  }
}

async function available() {
  try {
    await getBinary();
    return true;
  } catch {
    return false;
  }
}

module.exports = { runJson, getBinary, available, execute, buildArgs };
