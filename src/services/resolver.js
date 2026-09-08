'use strict';

const logger = require('../utils/logger');
const youtube = require('./sources/youtube');
const soundcloud = require('./sources/soundcloud');
const spotify = require('./sources/spotify');
const generic = require('./sources/generic');
const { UserError } = require('../utils/errors');

const HTTP_PATTERN = /^https?:\/\//i;

function detectSource(query) {
  if (spotify.isUrl(query)) return 'spotify';
  if (soundcloud.isUrl(query)) return 'soundcloud';
  if (youtube.isUrl(query)) return 'youtube';
  if (HTTP_PATTERN.test(query)) return 'link';
  return 'search';
}

async function resolveQuery(rawQuery, requestedBy) {
  const query = String(rawQuery ?? '').trim().replace(/^<|>$/g, '');
  if (!query) throw new UserError('Укажи ссылку или название трека.');

  const source = detectSource(query);
  logger.debug(`resolveQuery: источник=${source}, запрос="${query}"`);

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
      const results = await youtube.search(query, requestedBy, 1);
      if (!results.length) throw new UserError(`По запросу «${query}» ничего не нашлось.`);
      return { type: 'track', tracks: results, fromSearch: true };
    }
  }
}

async function getStream(track) {
  if (typeof track?.streamProvider !== 'function') {
    throw new UserError('Для этого трека не задан способ получения аудио.');
  }
  return track.streamProvider(track);
}

module.exports = { resolveQuery, resolveTrack: resolveQuery, getStream, detectSource };
