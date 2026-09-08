'use strict';

require('dotenv').config();

const path = require('node:path');

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  prefix: process.env.PREFIX || 't!',

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  },

  paths: {
    ytdlp: process.env.YTDLP_PATH || '',
    ffmpeg: process.env.FFMPEG_PATH || '',
    binDir: path.join(__dirname, 'bin'),
  },

  ytdlp: {
    cookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || '',
    cookiesFile: process.env.YTDLP_COOKIES_FILE || '',
    timeoutMs: int(process.env.YTDLP_TIMEOUT_MS, 30000),
    socketTimeout: int(process.env.YTDLP_SOCKET_TIMEOUT, 15),
  },

  queue: {
    maxSize: int(process.env.MAX_QUEUE_SIZE, 500),
    maxPlaylistSize: int(process.env.MAX_PLAYLIST_SIZE, 200),
    pageSize: 10,
  },

  player: {
    defaultVolume: clamp(int(process.env.DEFAULT_VOLUME, 50), 0, 100),
    leaveOnEmptyQueueMs: int(process.env.LEAVE_ON_EMPTY_QUEUE_SEC, 300) * 1000,
    leaveOnEmptyChannelMs: int(process.env.LEAVE_ON_EMPTY_CHANNEL_SEC, 60) * 1000,
    connectionTimeoutMs: 20000,
    streamStartTimeoutMs: 20000,
    maxStreamRetries: 1,
  },

  search: {
    resultsLimit: 5,
    durationToleranceSec: 25,
  },

  commandCooldownMs: 1200,
  logLevel: process.env.LOG_LEVEL || 'info',
};
