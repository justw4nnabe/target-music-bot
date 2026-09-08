'use strict';

const logger = require('../utils/logger');
const youtube = require('./sources/youtube');
const soundcloud = require('./sources/soundcloud');
const spotify = require('./sources/spotify');
const generic = require('./sources/generic');
const { UserError } = require('../utils/errors');

const HTTP_PATTERN = /^https?:\/\//i;

function parseSearchPrefix(input) {
  const trimmed = input.trim();

  if (/^(?:sc|soundcloud):?$/i.test(trimmed)) {
    return { forcedPlatform: 'soundcloud', queryText: '' };
  }
  if (/^(?:yt|youtube):?$/i.test(trimmed)) {
    return { forcedPlatform: 'youtube', queryText: '' };
  }

  const scMatch = trimmed.match(/^(?:sc|soundcloud)(?::\s*|\s+)(.+)$/i);
  if (scMatch) {
    return { forcedPlatform: 'soundcloud', queryText: scMatch[1].trim() };
  }

  const ytMatch = trimmed.match(/^(?:yt|youtube)(?::\s*|\s+)(.+)$/i);
  if (ytMatch) {
    return { forcedPlatform: 'youtube', queryText: ytMatch[1].trim() };
  }

  return { forcedPlatform: null, queryText: trimmed };
}

function detectSource(query) {
  if (spotify.isUrl(query)) return 'spotify';
  if (soundcloud.isUrl(query)) return 'soundcloud';
  if (youtube.isUrl(query)) return 'youtube';
  if (HTTP_PATTERN.test(query)) return 'link';
  return 'search';
}

async function resolveQuery(rawQuery, requestedBy) {
  const cleanQuery = String(rawQuery ?? '').trim().replace(/^<|>$/g, '');
  if (!cleanQuery) throw new UserError('Укажи ссылку или название трека.');

  const { forcedPlatform, queryText } = parseSearchPrefix(cleanQuery);
  if (forcedPlatform && !queryText) {
    throw new UserError(
      `Укажи поисковый запрос после префикса. Например: **${forcedPlatform === 'soundcloud' ? 'sc' : 'yt'} imagine dragons**.`,
    );
  }

  const query = queryText;
  const source = detectSource(query);
  logger.debug(`resolveQuery: источник=${source}, forcedPlatform=${forcedPlatform}, запрос="${query}"`);

  switch (source) {
    case 'spotify':
      return spotify.resolve(query, requestedBy);

    case 'soundcloud': {
      if (soundcloud.isPlaylistUrl(query)) {
        const playlist = await soundcloud.getPlaylist(query, requestedBy);
        return { type: 'playlist', ...playlist };
      }
      return { type: 'track', tracks: [await soundcloud.getTrack(query, requestedBy)] };
    }

    case 'youtube': {
      if (youtube.isPlaylistUrl(query)) {
        const playlist = await youtube.getPlaylist(query, requestedBy);
        return { type: 'playlist', ...playlist };
      }
      return { type: 'track', tracks: [await youtube.getTrack(query, requestedBy)] };
    }

    case 'link':
      return { type: 'track', tracks: [await generic.getTrack(query, requestedBy)] };

    default: {
      if (forcedPlatform === 'soundcloud') {
        const results = await soundcloud.search(query, requestedBy, 1);
        if (!results.length) throw new UserError(`По запросу «${query}» на SoundCloud ничего не нашлось.`);
        return { type: 'track', tracks: results, fromSearch: true };
      }

      if (forcedPlatform === 'youtube') {
        const results = await youtube.search(query, requestedBy, 1);
        if (!results.length) throw new UserError(`По запросу «${query}» на YouTube ничего не нашлось.`);
        return { type: 'track', tracks: results, fromSearch: true };
      }

      // Default: SoundCloud first, fallback to YouTube
      logger.debug(`resolveQuery: поиск на SoundCloud для «${query}»`);
      let results = [];
      try {
        results = await soundcloud.search(query, requestedBy, 1);
      } catch (error) {
        logger.debug(`SoundCloud search ошибка: ${error.message}`);
      }

      if (!results || !results.length) {
        logger.debug(`На SoundCloud ничего не найдено, поиск на YouTube для «${query}»`);
        results = await youtube.search(query, requestedBy, 1);
      }

      if (!results || !results.length) {
        throw new UserError(`По запросу «${query}» ничего не нашлось.`);
      }

      return { type: 'track', tracks: results, fromSearch: true };
    }
  }
}

async function searchTracks(rawQuery, requestedBy, limit = 5) {
  const cleanQuery = String(rawQuery ?? '').trim().replace(/^<|>$/g, '');
  if (!cleanQuery) throw new UserError('Укажи поисковый запрос.');

  const { forcedPlatform, queryText } = parseSearchPrefix(cleanQuery);
  if (forcedPlatform && !queryText) {
    throw new UserError(
      `Укажи поисковый запрос после префикса. Например: **${forcedPlatform === 'soundcloud' ? 'sc' : 'yt'} imagine dragons**.`,
    );
  }

  const query = queryText;

  if (forcedPlatform === 'soundcloud') {
    const results = await soundcloud.search(query, requestedBy, limit);
    return { platform: 'soundcloud', results };
  }

  if (forcedPlatform === 'youtube') {
    const results = await youtube.search(query, requestedBy, limit);
    return { platform: 'youtube', results };
  }

  // Default: try SoundCloud first
  try {
    const scResults = await soundcloud.search(query, requestedBy, limit);
    if (scResults && scResults.length) {
      return { platform: 'soundcloud', results: scResults };
    }
  } catch (error) {
    logger.debug(`SoundCloud searchTracks ошибка: ${error.message}`);
  }

  // Fallback to YouTube
  const ytResults = await youtube.search(query, requestedBy, limit);
  return { platform: 'youtube', results: ytResults };
}

async function getStream(track) {
  if (typeof track?.streamProvider !== 'function') {
    throw new UserError('Для этого трека не задан способ получения аудио.');
  }
  return track.streamProvider(track);
}

module.exports = { resolveQuery, resolveTrack: resolveQuery, searchTracks, getStream, detectSource, parseSearchPrefix };
