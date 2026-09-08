'use strict';

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.isUserError = true;
  }
}

const PATTERNS = [
  [/sign in to confirm|not a bot|confirm you.?re not a bot/i, 'YouTube требует подтверждения, что запрос не от бота. Добавь cookies в `.env` (`YTDLP_COOKIES_FROM_BROWSER=chrome`).'],
  [/video unavailable|this video is unavailable/i, 'Видео недоступно — возможно, удалено или заблокировано в этом регионе.'],
  [/private video|this playlist is private/i, 'Это приватное видео или плейлист — бот не может его открыть.'],
  [/members[- ]only|join this channel/i, 'Видео доступно только участникам канала.'],
  [/age[- ]restricted|confirm your age/i, 'Видео с возрастным ограничением. Нужны cookies авторизованного аккаунта.'],
  [/requested format is not available/i, 'У источника нет подходящей аудиодорожки.'],
  [/copyright|blocked it on copyright/i, 'Трек заблокирован по причине авторских прав.'],
  [/http error 429|too many requests|rate.?limit/i, 'Источник ограничил частоту запросов (429). Подожди пару минут.'],
  [/unable to download webpage|getaddrinfo|enotfound|econnreset|etimedout|socket timeout/i, 'Не удалось связаться с источником — проблема с сетью. Попробуй ещё раз.'],
  [/unsupported url/i, 'Ссылка не поддерживается. Пришли ссылку на YouTube, Spotify, SoundCloud или просто название трека.'],
  [/no video results|no results/i, 'По запросу ничего не нашлось.'],
  [/is not a valid url|invalid url/i, 'Ссылка выглядит некорректно.'],
  [/yt-dlp не найден|ffmpeg не найден/i, null],
];

function toUserMessage(error) {
  if (!error) return 'Неизвестная ошибка.';
  if (error.isUserError) return error.message;

  const haystack = [error.message, error.stderr, error.details].filter(Boolean).join('\n');
  for (const [pattern, message] of PATTERNS) {
    if (pattern.test(haystack)) return message ?? error.message;
  }
  return 'Что-то пошло не так при обработке запроса. Попробуй другой трек или ссылку.';
}

module.exports = { UserError, toUserMessage };
