'use strict';

const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isWindows = process.platform === 'win32';
const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN_NAME = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);

const RELEASES_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const ASSET_PATTERNS = {
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp',
  darwin: 'yt-dlp_macos',
};

function get(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'targetmusicbot/install-ytdlp' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        get(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} на ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    const req = client.get(url, { headers: { 'User-Agent': 'targetmusicbot/install-ytdlp' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const total = Number.parseInt(res.headers['content-length'], 10) || 0;
      let downloaded = 0;

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total) {
          const percent = Math.floor((downloaded / total) * 100);
          process.stdout.write(`\r  Скачиваю: ${percent}% (${(downloaded / 1e6).toFixed(1)} МБ)`);
        }
      });

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
    });

    req.on('error', (error) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(error);
    });

    file.on('error', (error) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(error);
    });
  });
}

async function getLatestAssetUrl() {
  console.log('  Получаю информацию о последней версии yt-dlp…');
  const data = JSON.parse((await get(RELEASES_URL)).toString('utf8'));
  const assetName = ASSET_PATTERNS[process.platform] ?? 'yt-dlp';
  const asset = data.assets.find((a) => a.name === assetName);

  if (!asset) {
    const names = data.assets.map((a) => a.name).join(', ');
    throw new Error(`Не нашёл ${assetName} в релизе. Доступные файлы: ${names}`);
  }

  console.log(`  Версия: ${data.tag_name}, файл: ${asset.name}`);
  return { url: asset.browser_download_url, version: data.tag_name };
}

async function main() {
  console.log('\nУстановка yt-dlp в bin/\n');

  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  try {
    const { url, version } = await getLatestAssetUrl();
    console.log(`  Скачиваю ${BIN_NAME}…`);
    await download(url, BIN_PATH);

    if (!isWindows) fs.chmodSync(BIN_PATH, '755');

    const result = await new Promise((resolve, reject) => {
      const child = spawn(BIN_PATH, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${code}`))));
    });

    console.log(`\n✅ yt-dlp ${result} установлен в bin/\n`);
  } catch (error) {
    console.error(`\n❌ Не удалось скачать yt-dlp: ${error.message}`);
    console.error('   Установи вручную: pip install -U yt-dlp');
    console.error('   Или скачай с https://github.com/yt-dlp/yt-dlp/releases\n');
    process.exit(1);
  }
}

main();
