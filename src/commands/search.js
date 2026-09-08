'use strict';

const config = require('../../config');
const embeds = require('../ui/embeds');
const components = require('../ui/components');
const youtube = require('../services/sources/youtube');
const { UserError } = require('../utils/errors');

module.exports = {
  name: 'search',
  aliases: ['поиск'],
  description: 'Поиск треков на YouTube с выбором трека из списка',
  usage: '<поисковый запрос>',
  requiresVoice: true,
  requiresSameChannel: true,

  async execute({ message, query, queues, voiceChannel, prefix }) {
    if (!query) {
      throw new UserError(`Укажи, что найти. Например: **${prefix}search imagine dragons**.`);
    }

    const queue = queues.ensure({ guild: message.guild, textChannel: message.channel });
    await queue.connect(voiceChannel);

    const requestedBy = {
      id: message.author.id,
      tag: message.author.tag,
      displayName: message.member?.displayName ?? message.author.username,
    };

    const statusNotice = await message.channel.send({ embeds: [embeds.info('Выполняю поиск…')] });

    let results;
    try {
      results = await youtube.search(query, requestedBy, 5);
    } catch (error) {
      await statusNotice.delete().catch(() => {});
      throw error;
    }

    if (!results || !results.length) {
      await statusNotice.delete().catch(() => {});
      throw new UserError(`По запросу «${query}» ничего не найдено.`);
    }

    const searchEmbed = embeds.searchResults(results);
    const row = components.searchRow(results.length);

    await statusNotice.edit({
      embeds: [searchEmbed],
      components: [row],
    });

    let handled = false;

    const handleSelection = async (index, interaction = null) => {
      if (handled) return;
      handled = true;

      const track = results[index];
      if (!track) return;

      const wasIdle = !queue.current;
      const { added } = queue.enqueue([track]);

      if (!added) {
        const errorEmbed = embeds.error(`Очередь заполнена (лимит ${config.queue.maxSize}).`);
        if (interaction) await interaction.update({ embeds: [errorEmbed], components: [] }).catch(() => {});
        else await statusNotice.edit({ embeds: [errorEmbed], components: [] }).catch(() => {});
        return;
      }

      if (wasIdle) {
        if (interaction) {
          await interaction.update({
            embeds: [embeds.addedTrack(track, 0)],
            components: [],
          }).catch(() => {});
        } else {
          await statusNotice.edit({
            embeds: [embeds.addedTrack(track, 0)],
            components: [],
          }).catch(() => {});
        }
        await queue.start();
        return;
      }

      const addedEmbed = embeds.addedTrack(track, queue.tracks.length);
      if (interaction) {
        await interaction.update({ embeds: [addedEmbed], components: [] }).catch(() => {});
      } else {
        await statusNotice.edit({ embeds: [addedEmbed], components: [] }).catch(() => {});
      }
    };

    // Button collector
    const buttonCollector = statusNotice.createMessageComponentCollector({
      filter: (i) => i.user.id === message.author.id,
      time: 30000,
    });

    // Chat message collector for numbers 1-5
    const msgCollector = message.channel.createMessageCollector({
      filter: (m) => m.author.id === message.author.id,
      time: 30000,
    });

    buttonCollector.on('collect', async (interaction) => {
      if (interaction.customId === 'search:cancel') {
        handled = true;
        buttonCollector.stop('cancelled');
        msgCollector.stop('cancelled');
        await interaction.update({ embeds: [embeds.info('Поиск отменён.')], components: [] }).catch(() => {});
        return;
      }

      const match = interaction.customId.match(/^search:select:(\d+)$/);
      if (match) {
        const index = Number.parseInt(match[1], 10) - 1;
        buttonCollector.stop('selected');
        msgCollector.stop('selected');
        await handleSelection(index, interaction);
      }
    });

    msgCollector.on('collect', async (msg) => {
      const text = msg.content.trim().toLowerCase();
      if (text === 'cancel' || text === 'отмена') {
        handled = true;
        buttonCollector.stop('cancelled');
        msgCollector.stop('cancelled');
        await statusNotice.edit({ embeds: [embeds.info('Поиск отменён.')], components: [] }).catch(() => {});
        return;
      }

      const num = Number.parseInt(text, 10);
      if (num >= 1 && num <= results.length) {
        buttonCollector.stop('selected');
        msgCollector.stop('selected');
        await msg.delete().catch(() => {});
        await handleSelection(num - 1);
      }
    });

    buttonCollector.on('end', async (_collected, reason) => {
      if (handled) return;
      await statusNotice.edit({
        embeds: [searchEmbed],
        components: [],
      }).catch(() => {});
    });
  },
};
