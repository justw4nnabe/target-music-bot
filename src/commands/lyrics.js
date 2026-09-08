'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');
const { truncate } = require('../utils/format');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function cleanTitle(str) {
  return str
    .replace(/\s*[\(\[](?:official|music|video|audio|lyrics|hd|4k|remastered|lyric video|visualizer|soundtrack|ost)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*ft\..*$/i, '')
    .replace(/\s*feat\..*$/i, '')
    .replace(/["']/g, '')
    .trim();
}

function extractGeniusLyrics(html) {
  const marker = 'data-lyrics-container="true"';
  let pos = 0;
  const containers = [];

  while ((pos = html.indexOf(marker, pos)) !== -1) {
    const startContent = html.indexOf('>', pos) + 1;
    let depth = 1;
    let curr = startContent;
    while (depth > 0 && curr < html.length) {
      const nextOpen = html.indexOf('<div', curr);
      const nextClose = html.indexOf('</div>', curr);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        curr = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          containers.push(html.slice(startContent, nextClose));
          curr = nextClose + 6;
          break;
        }
        curr = nextClose + 6;
      }
    }
    pos = curr;
  }

  if (!containers.length) return null;

  const fullText = containers.join('\n');
  const cleaned = fullText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/^\s*\d*\s*Contributors.*?\n/i, '')
    .replace(/^Translations.*?\n/i, '')
    .replace(/\d*\s*Embed$/i, '')
    .replace(/You might also like.*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || null;
}

async function searchGenius(query) {
  const searchUrl = `https://genius.com/api/search/song?page=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const sections = data.response?.sections || [];
  const songSection = sections.find((s) => s.type === 'song' || s.type === 'top_hit') || sections[0];
  return songSection?.hits || [];
}

async function fetchLyrics(rawQuery) {
  const cleaned = cleanTitle(rawQuery);
  const queries = [cleaned];
  if (rawQuery !== cleaned) queries.push(rawQuery);

  let hits = [];
  for (const q of queries) {
    try {
      hits = await searchGenius(q);
      if (hits.length) break;
    } catch {}
  }

  if (!hits.length) return null;

  const song = hits[0].result;
  if (!song?.url) return null;

  const pageRes = await fetch(song.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });

  if (!pageRes.ok) return null;

  const html = await pageRes.text();
  const lyrics = extractGeniusLyrics(html);
  if (!lyrics) return null;

  return {
    title: song.title || song.full_title || rawQuery,
    artist: song.primary_artist?.name || 'Genius',
    lyrics,
    url: song.url,
  };
}

module.exports = {
  name: 'lyrics',
  aliases: ['текст', 'слова'],
  description: 'Показать текст песни с сайта genius.com для текущего или указанного трека',
  usage: '[название песни]',

  async execute({ message, args, queue, prefix }) {
    let searchTerm = args.join(' ').trim();

    if (!searchTerm) {
      if (!queue?.current) {
        throw new UserError(`Укажи название песни или включи трек. Например: \`${prefix}lyrics Shape of You\`.`);
      }
      searchTerm = queue.current.title;
      if (queue.current.author && queue.current.author !== 'YouTube' && queue.current.author !== 'SoundCloud') {
        searchTerm = `${queue.current.author} ${searchTerm}`;
      }
    }

    const displayTerm = cleanTitle(searchTerm);
    const statusNotice = await message.channel.send({
      embeds: [embeds.info(`🔎 Ищу текст на Genius.com для «${truncate(displayTerm, 50)}»…`)],
    });

    try {
      const result = await fetchLyrics(searchTerm);
      if (!result || !result.lyrics) {
        await statusNotice.edit({
          embeds: [embeds.warning(`Текст для «**${truncate(displayTerm, 50)}**» на Genius.com не найден.`)],
        });
        return;
      }

      let text = result.lyrics.trim();
      if (text.length > 4000) {
        text = `${text.slice(0, 3950)}\n\n... [текст сокращён]`;
      }

      const lyricsEmbed = embeds.lyricsEmbed(result.title, result.artist, text, result.url);
      await statusNotice.edit({ embeds: [lyricsEmbed] });
    } catch (error) {
      await statusNotice.edit({
        embeds: [embeds.error(`Не удалось получить текст с Genius.com: ${error.message}`)],
      });
    }
  },
};
