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
  const target = track.playbackUrl ?? track.url;
  if (!target) throw new UserError('У трека нет ссылки на источник.');

  return {
    url: target,
    targetUrl: target,
    isYouTube: true,
    headers: {},
  };
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
    const info = await ytdlp.runJson(['--no-playlist', '--skip-download', '--flat-playlist', url]);
    const track = normalize(info, requestedBy);
    if (!track) throw new UserError('Не удалось разобрать это видео.');
    return track;
  } catch (error) {
    if (/sign in to confirm|not a bot|bot/i.test(error.message || error.stderr || '')) {
      throw new UserError('YouTube требует подтверждения для этого видео. Попробуй поиск по названию трека или SoundCloud.');
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

const { parseDuration } = require('../../utils/format');

const NON_MUSIC_REGEX =
  /(?:react|реакци|почему|что случилось|разбор|обзор|review|interview|интервью|podcast|подкаст|сколько бы|gameplay|геймплей|vlog|влог|shorts|разоблачени|stream|стрим|compilation|компиляц|mix\s*#|workout|hours?|минут|transition|конфликт|драка|истори|новости|news|тир-лист|tier\s*list|выбор|соловьев|политик|реч|шок|взрыв|скандал|playlist|chillout|vol\s*\d+|триллер|боевик|комедия|фильм|кино|сериал|movie|film|trailer|трейлер|beef|биф|джем|jam\s*–|type\s*beat|typebeat|free\s*beat|prodby|prod\s*by|instrumental\s*beat|ужас|страшн|крипипаст|creepypasta|интернет|pov:|товары|купил|распаковк|сгорел|погиб|трагеди|архив|уровн|легион|декор|ambience|decor|festive|asmr|асфр|факты|секреты|биография|documentary|документал)/i;

function extractVideoId(input) {
  if (!input) return null;
  const match = String(input).match(/(?:v=|youtu\.be\/|\/embed\/|\/v\/|shorts\/)([\w-]{11})/i);
  return match ? match[1] : null;
}

function isLikelyMusic(title, author = '', duration = 0, videoId = '') {
  if (!title) return false;
  if (videoId && /^RD/i.test(videoId)) return false;
  if (NON_MUSIC_REGEX.test(title) || NON_MUSIC_REGEX.test(author)) return false;
  if (/(?:beats|prodby|type\s*beat)/i.test(author)) return false;
  if (duration > 0 && (duration < 55 || duration > 600)) return false;
  return true;
}

async function searchFast(query, requestedBy, limit = 5) {
  try {
    const url = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'ru',
            gl: 'US',
          },
        },
        query,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    const section =
      json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents || [];

    const rawCandidates = [];
    for (const item of section) {
      const vr = item.videoRenderer;
      if (!vr || !vr.videoId) continue;

      const title = vr.title?.runs?.map((r) => r.text).join('') || vr.title?.simpleText || 'Без названия';
      const author = vr.ownerText?.runs?.[0]?.text || 'YouTube';
      const lengthText = vr.lengthText?.simpleText || '';
      const duration = lengthText ? parseDuration(lengthText) || 0 : 0;
      const thumb = vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`;

      rawCandidates.push({
        source: 'youtube',
        title,
        author,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        duration,
        thumbnail: thumb,
        requestedBy,
        streamProvider: fetchStream,
      });
    }

    const musicOnly = rawCandidates.filter((c) => isLikelyMusic(c.title, c.author, c.duration));
    const chosen = musicOnly.length ? musicOnly : rawCandidates;
    const tracks = chosen.slice(0, limit).map((c) => createTrack(c));

    return tracks.length ? tracks : null;
  } catch (error) {
    logger.debug(`searchFast ошибка: ${error.message}, переключаюсь на yt-dlp search`);
    return null;
  }
}

async function search(query, requestedBy, limit = config.search.resultsLimit) {
  const fastResults = await searchFast(query, requestedBy, limit);
  if (fastResults && fastResults.length) return fastResults;

  const info = await ytdlp.runJson(['--flat-playlist', `ytsearch${limit * 2}:${query}`]);
  const entries = (info.entries ?? []).filter(Boolean);
  const normalized = entries.map((entry) => normalize(entry, requestedBy)).filter(Boolean);
  const musicOnly = normalized.filter((t) => isLikelyMusic(t.title, t.author, t.duration));
  return (musicOnly.length ? musicOnly : normalized).slice(0, limit);
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

async function getRelatedTracks(track, limit = 10) {
  let videoId = extractVideoId(track?.url);
  if (!videoId && track?.title) {
    const searchTarget = track.author && track.author !== 'YouTube' && track.author !== 'SoundCloud'
      ? `${track.author} ${track.title}`
      : track.title;
    const found = await search(searchTarget, track.requestedBy, 1);
    if (found && found[0]) {
      videoId = extractVideoId(found[0].url);
    }
  }

  if (!videoId) return [];

  try {
    const url = 'https://www.youtube.com/youtubei/v1/next';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240101.00.00',
            hl: 'ru',
            gl: 'US',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];

    const json = await res.json();
    const candidates = [];

    const sec = json.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
    for (const it of sec) {
      const vm = it.lockupViewModel;
      if (vm?.contentId) {
        if (vm.contentId.startsWith('RD')) continue;
        const title = vm.metadata?.lockupMetadataViewModel?.title?.content || '';
        const author =
          vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]
            ?.text?.content || 'YouTube';
        if (isLikelyMusic(title, author, 0, vm.contentId)) {
          candidates.push({ videoId: vm.contentId, title, author });
        }
      }
    }

    const uniqueCandidates = [];
    const seen = new Set([videoId]);
    for (const c of candidates) {
      if (!seen.has(c.videoId)) {
        seen.add(c.videoId);
        uniqueCandidates.push(c);
      }
    }

    const tracks = [];
    for (const c of uniqueCandidates) {
      tracks.push(
        createTrack({
          source: 'youtube',
          title: c.title || 'Похожий трек',
          author: c.author || 'YouTube',
          url: `https://www.youtube.com/watch?v=${c.videoId}`,
          duration: 0,
          thumbnail: `https://i.ytimg.com/vi/${c.videoId}/hqdefault.jpg`,
          requestedBy: track.requestedBy,
          streamProvider: fetchStream,
        }),
      );
      if (tracks.length >= limit) break;
    }

    return tracks;
  } catch (error) {
    logger.debug(`getRelatedTracks ошибка: ${error.message}`);
    return [];
  }
}

module.exports = {
  isUrl,
  isPlaylistUrl,
  getTrack,
  getPlaylist,
  search,
  findBestMatch,
  fetchStream,
  extractVideoId,
  getRelatedTracks,
  isLikelyMusic,
};
