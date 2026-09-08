'use strict';

function createTrack({
  source,
  title,
  author = 'Неизвестный исполнитель',
  url,
  duration = 0,
  thumbnail = null,
  requestedBy = null,
  searchQuery = null,
  resolved = true,
  streamProvider,
  seekable = true,
  playbackUrl = null,
}) {
  return {
    source,
    title: title || 'Без названия',
    author,
    url: url || null,
    playbackUrl,
    duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
    thumbnail,
    requestedBy,
    searchQuery,
    resolved,
    streamProvider,
    seekable,
    cachedStream: null,
  };
}

function isLive(track) {
  return !track || track.duration <= 0;
}

module.exports = { createTrack, isLive };
