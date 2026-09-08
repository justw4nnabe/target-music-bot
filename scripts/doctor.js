'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

require('dotenv').config();

const CHECKS = [];

function check(name, fn) {
  CHECKS.push({ name, fn });
}

function probe(command, args, timeout = 8000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => { child.kill(); resolve(null); }, timeout);
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : null); });
  });
}

check('Node.js >=18', async () => {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) return { ok: false, detail: `Установлен Node.js ${process.version}, нужен >=18.17.0` };
  return { ok: true, detail: `Node.js ${process.version}` };
});

check('discord.js', async () => {
  try {
    const pkg = require('discord.js');
    return { ok: true, detail: `v${pkg.version}` };
  } catch {
    return { ok: false, detail: 'не установлен — запусти npm install' };
  }
});

check('@discordjs/voice', async () => {
  try {
    require('@discordjs/voice');
    return { ok: true, detail: 'установлен' };
  } catch {
    return { ok: false, detail: 'не установлен — запусти npm install' };
  }
});

check('Opus (кодек)', async () => {
  try {
    require('@discordjs/opus');
    return { ok: true, detail: '@discordjs/opus' };
  } catch {
    try {
      require('opusscript');
      return { ok: true, detail: 'opusscript (работает, но @discordjs/opus быстрее)' };
    } catch {
      return { ok: false, detail: 'ни @discordjs/opus, ни opusscript не установлены — npm install' };
    }
  }
});

check('Шифрование (sodium)', async () => {
  try {
    require('sodium-native');
    return { ok: true, detail: 'sodium-native' };
  } catch {
    try {
      const sodium = require('libsodium-wrappers');
      await sodium.ready;
      return { ok: true, detail: 'libsodium-wrappers' };
    } catch {
      return { ok: false, detail: 'ни sodium-native, ни libsodium-wrappers — голос не будет работать' };
    }
  }
});

check('ffmpeg', async () => {
  const candidates = [];
  const envPath = process.env.FFMPEG_PATH;
  if (envPath) candidates.push([envPath, []]);

  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath && fs.existsSync(staticPath)) candidates.push([staticPath, []]);
  } catch {}

  candidates.push(['ffmpeg', []]);

  for (const [cmd, args] of candidates) {
    const out = await probe(cmd, ['-version', ...args]);
    if (out) {
      const ver = out.split('\n')[0];
      return { ok: true, detail: ver };
    }
  }
  return { ok: false, detail: 'не найден — установи ffmpeg или задай FFMPEG_PATH в .env' };
});

check('yt-dlp', async () => {
  const binPath = path.join(__dirname, '..', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  const candidates = [];

  if (process.env.YTDLP_PATH) candidates.push([process.env.YTDLP_PATH, []]);
  if (fs.existsSync(binPath)) candidates.push([binPath, []]);
  candidates.push(['yt-dlp', []]);
  if (process.platform === 'win32') candidates.push(['py', ['-m', 'yt_dlp']]);
  candidates.push(['python', ['-m', 'yt_dlp']]);
  candidates.push(['python3', ['-m', 'yt_dlp']]);

  for (const [cmd, args] of candidates) {
    const out = await probe(cmd, [...args, '--version']);
    if (out) return { ok: true, detail: `${out.split('\n').pop().trim()} (${cmd})` };
  }
  return { ok: false, detail: 'не найден — запусти: npm run setup  ИЛИ  pip install -U yt-dlp' };
});

check('DISCORD_TOKEN', async () => {
  const token = process.env.DISCORD_TOKEN;
  if (!token) return { ok: false, detail: 'не задан в .env' };
  if (!token.includes('.')) return { ok: false, detail: 'похоже на некорректный токен' };
  return { ok: true, detail: `задан (${token.slice(0, 8)}…)` };
});

check('Spotify (опционально)', async () => {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return { ok: null, detail: 'не настроен — ссылки Spotify работать не будут' };
  return { ok: true, detail: `CLIENT_ID=${id.slice(0, 8)}…` };
});

async function main() {
  console.log('\n=== Диагностика targetmusicbot ===\n');

  let allOk = true;
  for (const { name, fn } of CHECKS) {
    const result = await fn().catch((error) => ({ ok: false, detail: error.message }));
    const icon = result.ok === true ? '✅' : result.ok === null ? '⚠️ ' : '❌';
    if (result.ok === false) allOk = false;
    console.log(`  ${icon} ${name}: ${result.detail}`);
  }

  console.log('');
  if (allOk) {
    console.log('Всё готово! Запускай: npm start\n');
  } else {
    console.log('Исправь отмеченные проблемы, затем повтори: npm run doctor\n');
    process.exitCode = 1;
  }
}

main();
