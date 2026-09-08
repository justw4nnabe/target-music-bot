'use strict';

const config = require('../../../config');
const logger = require('../../utils/logger');
const ytdlp = require('../ytdlp');
const { createTrack } = require('../track');
const { UserError } = require('../../utils/errors');

const URL_PATTERN = /^(?:https?:\/\/)?(?:www\.|music\.|m\.)?(?:youtube\.com|youtu\.be)\//i;
const STREAM_TTL_MS = 45 * 60 * 1000;
const FORMAT = 'bestaudio[protocol^=http]/bestaudio/best';

function isUrl(input) {
  return URL_PATTERN.test(String(input).trim());
}

function isPlaylistUrl(input) {
  if (!isUrl(input)) return false;
  try {
    const url = new URL(input.startsWith('http') ? input : `https://${input}`);
    return url.searchParams.has('list') && !url.searchParams.has('v');
  } catch {
    return false;
  }
}

function thumbnailFor(entry) {
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length) {
    const withSize = entry.thumbnails.filter((thumb) => thumb?.url);
    const best = withSize[withSize.length - 1];
    if (best?.url) return best.url;
  }
  if (entry.thumbnail) return entry.thumbnail;
  if (entry.id) return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
  return null;
}

function watchUrl(entry) {
  if (entry.webpage_url) return entry.webpage_url;
  if (entry.url && /^https?:/i.test(entry.url)) return entry.url;
  if (entry.id) return `https://www.youtube.com/watch?v=${entry.id}`;
  return null;
}

function pickStream(info) {
  if (info.url) return { url: info.url, headers: info.http_headers ?? {} };

  const requested = info.requested_formats?.[0] ?? info.requested_downloads?.[0];
  if (requested?.url) {
    return { url: requested.url, headers: requested.http_headers ?? info.http_headers ?? {} };
  }

  const audio = (info.formats ?? [])
    .filter((format) => format?.url && format.acodec && format.acodec !== 'none')
    .sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];

  if (audio) return { url: audio.url, headers: audio.http_headers ?? info.http_headers ?? {} };
  return null;
}

async function fetchStream(track) {
  const cached = track.cachedStream;
  if (cached && Date.now() - cached.at < STREAM_TTL_MS) return { url: cached.url, headers: cached.headers };

  const target = track.playbackUrl ?? track.url;
  if (!target) throw new UserError('У трека нет ссылки на источник.');

  try {
    const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', FORMAT, target]);
    const stream = pickStream(info);
    if (!stream) throw new UserError('У этого видео нет доступной аудиодорожки.');

    track.cachedStream = { ...stream, at: Date.now() };
    return stream;
  } catch (error) {
    if (/sign in to confirm|not a bot|bot/i.test(error.message || error.stderr || '')) {
      logger.warn(`YouTube запросил подтверждение бота для «${track.title}», пробую SoundCloud…`);
      try {
        const soundcloud = require('./soundcloud');
        const scQuery = `${track.title} ${track.author && track.author !== 'YouTube' ? track.author : ''}`.trim();
        const scResults = await soundcloud.search(scQuery, track.requestedBy, 1);
        if (scResults && scResults[0]) {
          const scStream = await soundcloud.fetchStream(scResults[0]);
          if (scStream) {
            logger.info(`Найдена копия трека «${track.title}» на SoundCloud, включаю её`);
            track.cachedStream = { ...scStream, at: Date.now() };
            return scStream;
          }
        }
      } catch (fallbackErr) {
        logger.debug(`SoundCloud fallback не удался: ${fallbackErr.message}`);
      }
    }
    throw error;
  }
}

function normalize(entry, requestedBy) {
  const url = watchUrl(entry);
  if (!url) return null;

  return createTrack({
    source: 'youtube',
    title: entry.title ?? entry.fulltitle ?? 'Без названия',
    author: entry.uploader ?? entry.channel ?? entry.artist ?? 'YouTube',
    url,
    duration: Number(entry.duration) || 0,
    thumbnail: thumbnailFor(entry),
    requestedBy,
    streamProvider: fetchStream,
  });
}

async function getTrack(url, requestedBy) {
  try {
    const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', FORMAT, url]);
    const track = normalize(info, requestedBy);
    if (!track) throw new UserError('Не удалось разобрать это видео.');

    const stream = pickStream(info);
    if (stream) track.cachedStream = { ...stream, at: Date.now() };

    return track;
  } catch (error) {
    if (/sign in to confirm|not a bot|bot/i.test(error.message || error.stderr || '')) {
      try {
        const flat = await ytdlp.runJson(['--no-playlist', '--skip-download', '--flat-playlist', url]);
        const track = normalize(flat, requestedBy);
        if (track) return track;
      } catch {}
    }
    throw error;
  }
}

async function getPlaylist(url, requestedBy) {
  const info = await ytdlp.runJson([
    '--yes-playlist',
    '--flat-playlist',
    '--playlist-end',
    String(config.queue.maxPlaylistSize),
    url,
  ]);

  const entries = (info.entries ?? []).filter((entry) => entry && entry.id);
  const tracks = entries
    .filter((entry) => entry.availability !== 'private' && entry.title !== '[Private video]' && entry.title !== '[Deleted video]')
    .map((entry) => normalize(entry, requestedBy))
    .filter(Boolean);

  if (!tracks.length) throw new UserError('В плейлисте нет доступных треков (возможно, он приватный).');

  return {
    title: info.title ?? 'Плейлист YouTube',
    url: info.webpage_url ?? url,
    thumbnail: tracks[0]?.thumbnail ?? null,
    tracks,
  };
}

async function search(query, requestedBy, limit = config.search.resultsLimit) {
  const info = await ytdlp.runJson(['--flat-playlist', `ytsearch${limit}:${query}`]);
  const entries = (info.entries ?? []).filter(Boolean);
  return entries.map((entry) => normalize(entry, requestedBy)).filter(Boolean);
}

async function findBestMatch(query, requestedBy, targetDuration = 0) {
  const results = await search(query, requestedBy, config.search.resultsLimit);
  if (!results.length) return null;
  if (!targetDuration) return results[0];

  const scored = results
    .map((track) => ({ track, delta: track.duration ? Math.abs(track.duration - targetDuration) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.delta - b.delta);

  const best = scored[0];
  if (best.delta <= config.search.durationToleranceSec) return best.track;

  logger.debug(`Совпадение по длительности слабое (${best.delta}с), беру первый результат поиска`);
  return results[0];
}

module.exports = {
  isUrl,
  isPlaylistUrl,
  getTrack,
  getPlaylist,
  search,
  findBestMatch,
  fetchStream,
};
