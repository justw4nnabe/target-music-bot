'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');
const { truncate } = require('../utils/format');

function cleanTitle(str) {
  return str
    .replace(/\s*[\(\[](?:official|music|video|audio|lyrics|hd|4k|remastered|lyric video)[^\)\]]*[\)\]]/gi, '')
    .replace(/ft\..*$/i, '')
    .replace(/feat\..*$/i, '')
    .trim();
}

async function fetchLyrics(query) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TargetMusicBot (Discord Bot)' },
  });

  if (!response.ok) return null;

  const list = await response.json();
  if (!Array.isArray(list) || !list.length) return null;

  const found = list.find((item) => item.plainLyrics) || list[0];
  if (!found || !found.plainLyrics) return null;

  return {
    title: found.trackName || query,
    artist: found.artistName || 'Неизвестный исполнитель',
    lyrics: found.plainLyrics,
  };
}

module.exports = {
  name: 'lyrics',
  aliases: ['текст', 'слова'],
  description: 'Показать текст текущей или указанной песни',
  usage: '[название песни]',

  async execute({ message, args, queue, reply, prefix }) {
    let searchTerm = args.join(' ').trim();

    if (!searchTerm) {
      if (!queue?.current) {
        throw new UserError(`Укажи название песни или включи трек. Например: \`${prefix}lyrics Shape of You\`.`);
      }
      searchTerm = cleanTitle(queue.current.title);
    }

    const statusNotice = await message.channel.send({ embeds: [embeds.info(`🔎 Ищу текст для «${truncate(searchTerm, 50)}»…`)] });

    try {
      const result = await fetchLyrics(searchTerm);
      if (!result || !result.lyrics) {
        await statusNotice.edit({
          embeds: [embeds.warning(`Текст для «**${truncate(searchTerm, 50)}**» не найден.`)],
        });
        return;
      }

      let text = result.lyrics.trim();
      if (text.length > 4000) {
        text = text.slice(0, 3950) + '\n\n... [текст сокращён]';
      }

      const lyricsEmbed = embeds.lyricsEmbed(result.title, result.artist, text);
      await statusNotice.edit({ embeds: [lyricsEmbed] });
    } catch (error) {
      await statusNotice.edit({
        embeds: [embeds.error(`Не удалось получить текст: ${error.message}`)],
      });
    }
  },
};
