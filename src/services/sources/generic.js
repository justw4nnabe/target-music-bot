'use strict';

const ytdlp = require('../ytdlp');
const { createTrack } = require('../track');
const { UserError } = require('../../utils/errors');

const STREAM_TTL_MS = 20 * 60 * 1000;

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

  const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', 'bestaudio/best', target]);
  const stream = pickStream(info);
  if (!stream) throw new UserError('По этой ссылке нет доступного аудиопотока.');

  track.cachedStream = { ...stream, at: Date.now() };
  return stream;
}

async function getTrack(url, requestedBy) {
  const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '-f', 'bestaudio/best', url]);

  const track = createTrack({
    source: info.extractor_key ? String(info.extractor_key).toLowerCase() : 'link',
    title: info.title ?? 'Без названия',
    author: info.uploader ?? info.channel ?? info.extractor_key ?? 'Ссылка',
    url: info.webpage_url ?? url,
    duration: Number(info.duration) || 0,
    thumbnail: info.thumbnail ?? info.thumbnails?.[info.thumbnails.length - 1]?.url ?? null,
    requestedBy,
    streamProvider: fetchStream,
  });

  const stream = pickStream(info);
  if (stream) track.cachedStream = { ...stream, at: Date.now() };

  return track;
}

module.exports = { getTrack, fetchStream };
