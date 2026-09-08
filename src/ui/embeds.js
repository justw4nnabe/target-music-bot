'use strict';

const { EmbedBuilder } = require('discord.js');

const config = require('../../config');
const { formatDuration, progressBar, truncate, escapeMarkdown, tracksWord } = require('../utils/format');

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x2b2d31,
};

const SOURCES = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  link: 'Ссылка',
};

const LOOP_LABELS = {
  off: 'выключен',
  track: 'трек',
  queue: 'очередь',
};

function sourceLabel(track) {
  return SOURCES[track?.source] ?? (track?.source || 'Ссылка');
}

function trackLink(track, max = 60) {
  const title = escapeMarkdown(truncate(track?.title ?? 'Без названия', max));
  return track?.url ? `[${title}](${track.url})` : title;
}

function requesterLine(track) {
  const name = track?.requestedBy?.displayName ?? track?.requestedBy?.tag;
  return name ? `Заказал: ${name}` : 'Заказал: неизвестно';
}

function base(color) {
  return new EmbedBuilder().setColor(color);
}

function error(text) {
  return base(COLORS.danger).setDescription(text);
}

function warning(text) {
  return base(COLORS.warning).setDescription(text);
}

function success(text) {
  return base(COLORS.success).setDescription(text);
}

function info(text) {
  return base(COLORS.primary).setDescription(text);
}

function trackStarted(track) {
  const embed = base(COLORS.primary)
    .setAuthor({ name: 'Сейчас играет' })
    .setTitle(truncate(track.title, 100))
    .addFields(
      { name: 'Длительность', value: formatDuration(track.duration), inline: true },
      { name: 'Источник', value: sourceLabel(track), inline: true },
    )
    .setFooter({ text: requesterLine(track) });

  if (track.url) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function nowPlaying(queue) {
  const track = queue.current;
  if (!track) return info('Сейчас ничего не играет.');

  const position = queue.getPosition();
  const bar = progressBar(position, track.duration, 22);
  const timeline = track.duration
    ? `**${formatDuration(position)}** ${bar} **${formatDuration(track.duration)}**`
    : bar;

  const embed = base(COLORS.primary)
    .setAuthor({ name: queue.paused ? 'На паузе' : 'Сейчас играет' })
    .setTitle(truncate(track.title, 100))
    .setDescription(timeline)
    .addFields(
      { name: 'Громкость', value: `${queue.volume}%`, inline: true },
      { name: 'Повтор', value: LOOP_LABELS[queue.loopMode], inline: true },
      { name: 'В очереди', value: `${queue.tracks.length} ${tracksWord(queue.tracks.length)}`, inline: true },
    )
    .setFooter({ text: requesterLine(track) });

  if (track.url) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function addedTrack(track, position) {
  const embed = base(COLORS.success)
    .setAuthor({ name: position > 0 ? 'Добавлено в очередь' : 'Выбран трек' })
    .setTitle(truncate(track.title, 100))
    .addFields(
      { name: 'Длительность', value: formatDuration(track.duration), inline: true },
      { name: 'Позиция', value: position > 0 ? `#${position}` : 'играет сейчас', inline: true },
      { name: 'Источник', value: sourceLabel(track), inline: true },
    )
    .setFooter({ text: requesterLine(track) });

  if (track.url) embed.setURL(track.url);
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function addedPlaylist(playlist, added, skipped = 0) {
  const total = playlist.tracks.reduce((sum, track) => sum + track.duration, 0);
  const embed = base(COLORS.success)
    .setAuthor({ name: 'Плейлист добавлен' })
    .setTitle(truncate(playlist.title, 100))
    .addFields(
      { name: 'Добавлено', value: `${added} ${tracksWord(added)}`, inline: true },
      { name: 'Общая длительность', value: total > 0 ? formatDuration(total) : '—', inline: true },
    );

  if (playlist.url) embed.setURL(playlist.url);
  if (playlist.thumbnail) embed.setThumbnail(playlist.thumbnail);
  if (skipped > 0) {
    embed.setFooter({ text: `Пропущено из-за лимита очереди: ${skipped}` });
  }
  return embed;
}

function queueList(queue, page = 1) {
  const pageSize = config.queue.pageSize;
  const totalPages = Math.max(1, Math.ceil(queue.tracks.length / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  const slice = queue.tracks.slice(start, start + pageSize);

  const embed = base(COLORS.primary).setAuthor({ name: 'Очередь воспроизведения' });

  const sections = [];

  if (queue.current) {
    const status = queue.paused ? '**Сейчас на паузе:**' : '**Сейчас играет:**';
    sections.push(`${status}\n${trackLink(queue.current, 65)} — ${formatDuration(queue.current.duration)}`);
  }

  if (!slice.length) {
    sections.push(`**Очередь:**\n*Дальше ничего нет — добавь треки командой **${config.prefix}play**.*`);
  } else {
    const lines = slice.map((track, index) => {
      const number = start + index + 1;
      return `**${number}.** ${trackLink(track, 52)} — ${formatDuration(track.duration)}`;
    });
    sections.push(`**Очередь:**\n${lines.join('\n')}`);
  }

  embed.setDescription(sections.join('\n\n'));

  const totalDuration = queue.tracks.reduce((sum, track) => sum + track.duration, 0);
  embed.setFooter({
    text: `Страница ${current}/${totalPages} • всего ${queue.tracks.length} ${tracksWord(queue.tracks.length)} • ${formatDuration(totalDuration)} • повтор: ${LOOP_LABELS[queue.loopMode]}`,
  });

  return { embed, page: current, totalPages };
}

function searchResults(tracks) {
  const lines = tracks.map((track, index) => `**${index + 1}.** ${trackLink(track, 55)} — ${formatDuration(track.duration)}`);
  return base(COLORS.primary).setAuthor({ name: 'Результаты поиска' }).setDescription(lines.join('\n'));
}

function help(commands, prefix) {
  const lines = commands.map((command) => {
    const usage = command.usage ? ` ${command.usage}` : '';
    return `**${prefix}${command.name}${usage}** — ${command.description}`;
  });

  return base(COLORS.primary)
    .setAuthor({ name: 'Команды бота' })
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Префикс: ${prefix} • подробнее: ${prefix}help <команда>` });
}

function commandHelp(command, prefix) {
  const usage = command.usage ? ` ${command.usage}` : '';
  const embed = base(COLORS.primary)
    .setAuthor({ name: `Команда: ${prefix}${command.name}` })
    .setDescription(command.description || 'Нет описания')
    .addFields({ name: 'Использование', value: `**${prefix}${command.name}${usage}**`, inline: false });

  if (command.aliases && command.aliases.length) {
    embed.addFields({
      name: 'Алиасы',
      value: command.aliases.map((a) => `**${prefix}${a}**`).join(', '),
      inline: false,
    });
  }

  return embed;
}

function lyricsEmbed(title, artist, lyrics, url = null) {
  const embed = base(COLORS.primary)
    .setTitle(`Текст песни: ${truncate(title, 80)}`)
    .setAuthor({ name: truncate(artist, 80) })
    .setDescription(lyrics)
    .setFooter({ text: 'Источник: genius.com' });

  if (url) embed.setURL(url);
  return embed;
}

module.exports = {
  COLORS,
  error,
  warning,
  success,
  info,
  nowPlaying,
  trackStarted,
  addedTrack,
  addedPlaylist,
  queueList,
  searchResults,
  help,
  commandHelp,
  lyricsEmbed,
  sourceLabel,
  trackLink,
};
