'use strict';

const config = require('../../../config');
const ytdlp = require('../ytdlp');
const { createTrack } = require('../track');
const { UserError } = require('../../utils/errors');

const URL_PATTERN = /^(?:https?:\/\/)?(?:www\.|m\.)?soundcloud\.com\//i;
const STREAM_TTL_MS = 20 * 60 * 1000;
const FORMAT = 'bestaudio/best';

function isUrl(input) {
  return URL_PATTERN.test(String(input).trim());
}

function isPlaylistUrl(input) {
  return isUrl(input) && /\/sets\//i.test(input);
}

function thumbnailFor(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  if (Array.isArray(entry.thumbnails) && entry.thumbnails.length) {
    return entry.thumbnails[entry.thumbnails.length - 1]?.url ?? null;
  }
  return null;
}

function pickStream(info) {
  if (info.url) return { url: info.url, headers: info.http_headers ?? {} };

  const requested = info.requested_formats?.[0];
  if (requested?.url) return { url: requested.url, headers: requested.http_headers ?? info.http_headers ?? {} };

  const audio = (info.formats ?? [])
    .filter((format) => format?.url && format.acodec !== 'none')
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
    if (!stream) throw new UserError('У этого трека SoundCloud нет доступного аудиопотока.');

    // Always update track metadata with real fetched info
    if (info.title) {
      let fullTitle = info.title;
      const author = info.uploader ?? info.channel ?? track.author;
      if (author && author !== 'SoundCloud' && !fullTitle.toLowerCase().includes(author.toLowerCase())) {
        fullTitle = `${author} - ${fullTitle}`;
      }
      track.title = fullTitle;
    }
    if (info.uploader && info.uploader !== 'SoundCloud') {
      track.author = info.uploader;
    }
    if (info.duration) {
      track.duration = Math.round(Number(info.duration)) || 0;
    }
    if (info.webpage_url && (!track.url || track.url.includes('api-v2.soundcloud.com'))) {
      track.url = info.webpage_url;
    }
    if (info.thumbnail && !track.thumbnail) {
      track.thumbnail = thumbnailFor(info);
    }
    track.resolved = true;

    track.cachedStream = { ...stream, at: Date.now() };
    return stream;
  } catch (error) {
    if (/DRM protected/i.test(error.message || error.stderr || '')) {
      const logger = require('../../utils/logger');
      logger.warn(`SoundCloud трек защищен DRM («${track.title}»). Переключаюсь на YouTube…`);
      const youtube = require('./youtube');
      const ytMatch = await youtube.findBestMatch(track.title, track.requestedBy, track.duration);
      if (ytMatch) {
        logger.info(`SoundCloud DRM -> перенаправлен на YouTube: ${ytMatch.url}`);
        track.playbackUrl = ytMatch.url;
        return {
          url: ytMatch.url,
          targetUrl: ytMatch.url,
          isYouTube: true,
          headers: {},
        };
      }
      throw new UserError('Этот трек в SoundCloud защищён DRM, и на YouTube не удалось найти замену.');
    }
    throw error;
  }
}

function normalize(entry, requestedBy, index = 0) {
  const url = entry.webpage_url ?? (typeof entry.url === 'string' && /^https?:/i.test(entry.url) ? entry.url : null);
  if (!url) return null;

  let title = entry.title;
  let author = entry.uploader ?? entry.channel ?? entry.album_artist ?? entry.artist ?? 'SoundCloud';

  if (!title) {
    const slugMatch = url.match(/soundcloud\.com\/[^/]+\/([^/?#]+)/);
    if (slugMatch && !/^tracks$/i.test(slugMatch[1])) {
      const slug = slugMatch[1].replace(/-\d+$/, '').replace(/-/g, ' ');
      title = slug.charAt(0).toUpperCase() + slug.slice(1);
    } else if (entry.album) {
      title = `Трек ${index + 1} (${entry.album})`;
    } else {
      title = `Трек #${index + 1}`;
    }
  }

  if (author && author !== 'SoundCloud' && !title.toLowerCase().includes(author.toLowerCase())) {
    title = `${author} - ${title}`;
  }

  return createTrack({
    source: 'soundcloud',
    title,
    author,
    url,
    duration: Number(entry.duration) || 0,
    thumbnail: thumbnailFor(entry),
    requestedBy,
    streamProvider: fetchStream,
  });
}

async function getTrack(url, requestedBy) {
  const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', FORMAT, url]);
  const track = normalize(info, requestedBy);
  if (!track) throw new UserError('Не удалось разобрать этот трек SoundCloud.');

  const stream = pickStream(info);
  if (stream) track.cachedStream = { ...stream, at: Date.now() };

  return track;
}

async function getPlaylist(url, requestedBy) {
  const info = await ytdlp.runJson([
    '--yes-playlist',
    '--flat-playlist',
    '--playlist-end',
    String(config.queue.maxPlaylistSize),
    url,
  ]);

  const rawEntries = (info.entries ?? []).filter(Boolean);
  const tracks = rawEntries.map((entry, idx) => normalize(entry, requestedBy, idx)).filter(Boolean);
  if (!tracks.length) throw new UserError('В этом сете SoundCloud нет доступных треков.');

  return {
    title: info.title ?? 'Сет SoundCloud',
    url: info.webpage_url ?? url,
    thumbnail: tracks[0]?.thumbnail ?? null,
    tracks,
  };
}

async function search(query, requestedBy, limit = config.search.resultsLimit) {
  const fetchLimit = Math.max(limit * 2, 5);
  const info = await ytdlp.runJson(['--flat-playlist', `scsearch${fetchLimit}:${query}`]);
  const entries = (info.entries ?? []).filter(Boolean);
  const normalized = entries.map((entry) => normalize(entry, requestedBy)).filter(Boolean);
  const fullTracks = normalized.filter((t) => !t.duration || t.duration >= 50);
  return (fullTracks.length ? fullTracks : normalized).slice(0, limit);
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

  return results[0];
}

async function resolveTrack(track) {
  if (track.resolved && !track.url?.includes('api-v2.soundcloud.com') && track.duration > 0) return track;
  const target = track.playbackUrl ?? track.url;
  if (!target) return track;

  try {
    const info = await ytdlp.runJson(['--no-playlist', '--skip-download', target]);
    if (info.title) {
      let fullTitle = info.title;
      const author = info.uploader ?? info.channel ?? track.author;
      if (author && author !== 'SoundCloud' && !fullTitle.toLowerCase().includes(author.toLowerCase())) {
        fullTitle = `${author} - ${fullTitle}`;
      }
      track.title = fullTitle;
    }
    if (info.uploader && info.uploader !== 'SoundCloud') track.author = info.uploader;
    if (info.duration) track.duration = Math.round(Number(info.duration)) || 0;
    if (info.webpage_url) track.url = info.webpage_url;
    if (info.thumbnail && !track.thumbnail) track.thumbnail = thumbnailFor(info);
    track.resolved = true;
  } catch {}

  return track;
}

module.exports = { isUrl, isPlaylistUrl, getTrack, getPlaylist, search, findBestMatch, fetchStream, resolveTrack };
