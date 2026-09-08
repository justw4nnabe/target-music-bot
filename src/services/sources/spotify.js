'use strict';

const SpotifyWebApi = require('spotify-web-api-node');

const config = require('../../../config');
const logger = require('../../utils/logger');
const youtube = require('./youtube');
const { createTrack } = require('../track');
const { UserError } = require('../../utils/errors');

const URL_PATTERN = /^(?:https?:\/\/)?(?:open|play)\.spotify\.com\//i;
const URI_PATTERN = /^spotify:(track|album|playlist):([A-Za-z0-9]+)/i;

let api = null;
let tokenExpiresAt = 0;
let pendingAuth = null;

function isConfigured() {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret);
}

function isUrl(input) {
  const value = String(input).trim();
  return URL_PATTERN.test(value) || URI_PATTERN.test(value);
}

function parse(input) {
  const value = String(input).trim();

  const uriMatch = value.match(URI_PATTERN);
  if (uriMatch) return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    const match = url.pathname.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/i);
    if (match) return { type: match[1].toLowerCase(), id: match[2] };
  } catch {
    return null;
  }

  return null;
}

async function client() {
  if (!isConfigured()) {
    throw new UserError(
      'Spotify не настроен. Добавь `SPOTIFY_CLIENT_ID` и `SPOTIFY_CLIENT_SECRET` в `.env` — либо пришли ссылку на YouTube/SoundCloud.',
    );
  }

  if (!api) {
    api = new SpotifyWebApi({ clientId: config.spotify.clientId, clientSecret: config.spotify.clientSecret });
  }

  if (Date.now() < tokenExpiresAt) return api;

  if (!pendingAuth) {
    pendingAuth = api
      .clientCredentialsGrant()
      .then((result) => {
        api.setAccessToken(result.body.access_token);
        tokenExpiresAt = Date.now() + (result.body.expires_in - 60) * 1000;
        logger.debug('Токен Spotify обновлён');
        return api;
      })
      .catch((error) => {
        logger.error('Не удалось получить токен Spotify:', error.message);
        throw new UserError('Не удалось авторизоваться в Spotify — проверь `SPOTIFY_CLIENT_ID` и `SPOTIFY_CLIENT_SECRET`.');
      })
      .finally(() => {
        pendingAuth = null;
      });
  }

  return pendingAuth;
}

function imageFrom(images) {
  if (!Array.isArray(images) || !images.length) return null;
  return images[0]?.url ?? null;
}

async function fetchStream(track) {
  if (!track.playbackUrl) {
    const match = await youtube.findBestMatch(track.searchQuery, track.requestedBy, track.duration);
    if (!match) {
      throw new UserError(`На YouTube не нашлось совпадения для «${track.title}» — трек пропущен.`);
    }

    track.playbackUrl = match.url;
    track.resolved = true;
    if (!track.duration) track.duration = match.duration;
    if (!track.thumbnail) track.thumbnail = match.thumbnail;
    logger.debug(`Spotify -> YouTube: «${track.searchQuery}» => ${match.url}`);
  }

  return youtube.fetchStream(track);
}

function toTrack(meta, requestedBy, fallbackImage = null) {
  if (!meta || meta.type === 'episode') return null;

  const author = (meta.artists ?? []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Неизвестный исполнитель';
  const title = meta.name ?? 'Без названия';

  return createTrack({
    source: 'spotify',
    title,
    author,
    url: meta.external_urls?.spotify ?? null,
    duration: Math.round((meta.duration_ms ?? 0) / 1000),
    thumbnail: imageFrom(meta.album?.images) ?? fallbackImage,
    requestedBy,
    searchQuery: `${author} - ${title}`,
    resolved: false,
    streamProvider: fetchStream,
  });
}

function wrapApiError(error, kind) {
  if (error?.isUserError) return error;
  if (error?.statusCode === 404) return new UserError(`${kind} не найден в Spotify (или он приватный).`);
  if (error?.statusCode === 429) return new UserError('Spotify ограничил частоту запросов. Подожди немного.');
  logger.error(`Ошибка Spotify API (${kind}):`, error?.message ?? error);
  return new UserError(`Не удалось получить данные из Spotify (${kind}).`);
}

async function getTrack(id, requestedBy) {
  try {
    const spotify = await client();
    const { body } = await spotify.getTrack(id);
    const track = toTrack(body, requestedBy);
    if (!track) throw new UserError('Этот объект Spotify не является музыкальным треком.');
    return track;
  } catch (error) {
    throw wrapApiError(error, 'трек');
  }
}

async function getAlbum(id, requestedBy) {
  try {
    const spotify = await client();
    const { body } = await spotify.getAlbum(id);
    const cover = imageFrom(body.images);

    const items = [...(body.tracks?.items ?? [])];
    let offset = items.length;

    while (body.tracks?.total > items.length && items.length < config.queue.maxPlaylistSize) {
      const page = await spotify.getAlbumTracks(id, { offset, limit: 50 });
      if (!page.body.items?.length) break;
      items.push(...page.body.items);
      offset += page.body.items.length;
    }

    const tracks = items
      .slice(0, config.queue.maxPlaylistSize)
      .map((item) => toTrack(item, requestedBy, cover))
      .filter(Boolean);

    if (!tracks.length) throw new UserError('В этом альбоме нет треков.');

    return { title: body.name ?? 'Альбом Spotify', url: body.external_urls?.spotify ?? null, thumbnail: cover, tracks };
  } catch (error) {
    throw wrapApiError(error, 'альбом');
  }
}

async function getPlaylist(id, requestedBy) {
  try {
    const spotify = await client();
    const { body } = await spotify.getPlaylist(id, { fields: 'name,external_urls,images,tracks(total)' });
    const cover = imageFrom(body.images);

    const items = [];
    let offset = 0;

    while (items.length < config.queue.maxPlaylistSize) {
      const page = await spotify.getPlaylistTracks(id, {
        offset,
        limit: 100,
        fields: 'items(track(name,type,duration_ms,external_urls,artists(name),album(images))),next',
      });

      const chunk = page.body.items ?? [];
      if (!chunk.length) break;

      items.push(...chunk);
      offset += chunk.length;
      if (!page.body.next) break;
    }

    const tracks = items
      .slice(0, config.queue.maxPlaylistSize)
      .map((item) => toTrack(item?.track, requestedBy, cover))
      .filter(Boolean);

    if (!tracks.length) throw new UserError('В этом плейлисте нет доступных треков.');

    return { title: body.name ?? 'Плейлист Spotify', url: body.external_urls?.spotify ?? null, thumbnail: cover, tracks };
  } catch (error) {
    throw wrapApiError(error, 'плейлист');
  }
}

async function resolve(input, requestedBy) {
  const parsed = parse(input);
  if (!parsed) throw new UserError('Не удалось разобрать ссылку Spotify.');

  if (parsed.type === 'track') {
    const track = await getTrack(parsed.id, requestedBy);
    return { type: 'track', tracks: [track] };
  }

  const collection = parsed.type === 'album' ? await getAlbum(parsed.id, requestedBy) : await getPlaylist(parsed.id, requestedBy);
  return { type: 'playlist', ...collection };
}

module.exports = { isUrl, isConfigured, parse, resolve, fetchStream };
