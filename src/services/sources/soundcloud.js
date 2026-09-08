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

  const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', FORMAT, target]);
  const stream = pickStream(info);
  if (!stream) throw new UserError('У этого трека SoundCloud нет доступного аудиопотока.');

  track.cachedStream = { ...stream, at: Date.now() };
  return stream;
}

function normalize(entry, requestedBy) {
  const url = entry.webpage_url ?? (typeof entry.url === 'string' && /^https?:/i.test(entry.url) ? entry.url : null);
  if (!url) return null;

  return createTrack({
    source: 'soundcloud',
    title: entry.title ?? 'Без названия',
    author: entry.uploader ?? entry.channel ?? 'SoundCloud',
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

  const tracks = (info.entries ?? []).filter(Boolean).map((entry) => normalize(entry, requestedBy)).filter(Boolean);
  if (!tracks.length) throw new UserError('В этом сете SoundCloud нет доступных треков.');

  return {
    title: info.title ?? 'Сет SoundCloud',
    url: info.webpage_url ?? url,
    thumbnail: tracks[0]?.thumbnail ?? null,
    tracks,
  };
}

async function search(query, requestedBy, limit = config.search.resultsLimit) {
  const info = await ytdlp.runJson(['--flat-playlist', `scsearch${limit}:${query}`]);
  return (info.entries ?? []).filter(Boolean).map((entry) => normalize(entry, requestedBy)).filter(Boolean);
}

module.exports = { isUrl, isPlaylistUrl, getTrack, getPlaylist, search, fetchStream };
