'use strict';

const config = require('../../config');
const { MessageFlags } = require('discord.js');
const embeds = require('../ui/embeds');
const resolver = require('../services/resolver');
const { UserError } = require('../utils/errors');
const { tracksWord } = require('../utils/format');

module.exports = {
  name: 'play',
  aliases: ['p', 'играть', 'и'],
  description: 'Включить трек или плейлист (YouTube, Spotify, SoundCloud или текстовый поиск)',
  usage: '<ссылка или название>',
  requiresVoice: true,
  requiresSameChannel: true,

  async execute({ message, query, queues, voiceChannel, prefix }) {
    if (!query) {
      throw new UserError(`Укажи, что включить. Например: **${prefix}play группа крови** или ссылку на трек.`);
    }

    const queue = queues.ensure({ guild: message.guild, textChannel: message.channel });
    await queue.connect(voiceChannel);

    const requestedBy = {
      id: message.author.id,
      tag: message.author.tag,
      displayName: message.member?.displayName ?? message.author.username,
    };

    const notice = await message.channel.send({
      embeds: [embeds.info('Ищу…')],
      flags: MessageFlags.SuppressNotifications,
    });

    try {
      const result = await resolver.resolveQuery(query, requestedBy);

      if (result.type === 'playlist') {
        const { added, skipped } = queue.enqueue(result.tracks);
        if (!added) throw new UserError(`Очередь заполнена (лимит ${config.queue.maxSize}).`);

        await notice.edit({ embeds: [embeds.addedPlaylist(result, added, skipped)] });
        await queue.start();
        return;
      }

      const [track] = result.tracks;
      const wasIdle = !queue.current;
      const { added } = queue.enqueue([track]);
      if (!added) throw new UserError(`Очередь заполнена (лимит ${config.queue.maxSize}).`);

      await notice.edit({ embeds: [embeds.addedTrack(track, wasIdle ? 0 : queue.tracks.length)] });

      if (wasIdle) {
        await queue.start();
        return;
      }
    } catch (error) {
      await notice.delete().catch(() => {});
      if (queue.isEmpty) queue.scheduleIdleLeave();
      throw error;
    }
  },
};
