'use strict';

const { Events, MessageFlags } = require('discord.js');

const embeds = require('../ui/embeds');
const components = require('../ui/components');
const logger = require('../utils/logger');
const { UserError, toUserMessage } = require('../utils/errors');

const READ_ONLY = new Set([components.IDS.queue, components.IDS.queuePrev, components.IDS.queueNext]);

function requireQueue(client, interaction) {
  const queue = client.queues.get(interaction.guild.id);
  if (!queue || queue.destroyed) throw new UserError('Плеер уже неактивен.');
  return queue;
}

function requireSameChannel(interaction) {
  const botChannelId = interaction.guild.members.me?.voice?.channelId;
  const userChannelId = interaction.member?.voice?.channelId;

  if (!botChannelId) throw new UserError('Я не в голосовом канале.');
  if (userChannelId !== botChannelId) throw new UserError('Зайди в мой голосовой канал, чтобы управлять плеером.');
}

async function handleButton(client, interaction) {
  const [namespace, action] = interaction.customId.split(':');
  if (namespace !== 'music' && namespace !== 'queue') return;
  if (interaction.customId === 'queue:page') {
    await interaction.deferUpdate().catch(() => {});
    return;
  }

  const key = `${namespace}:${action}`;
  const queue = requireQueue(client, interaction);
  if (!READ_ONLY.has(key)) requireSameChannel(interaction);

  switch (key) {
    case components.IDS.toggle: {
      if (queue.paused) queue.resume();
      else queue.pause();
      await interaction.update({ components: components.playerRows(queue) });
      return;
    }

    case components.IDS.loop: {
      queue.cycleLoop();
      await interaction.update({ components: components.playerRows(queue) });
      return;
    }

    case components.IDS.autoplay: {
      const isOtherTrackWithAutoplay = Boolean(queue.current?.isAutoplay || queue.current?.autoplayActiveOnStart);
      if (isOtherTrackWithAutoplay && !queue.autoplay) {
        await interaction.reply({
          content: 'На этом треке автовоспроизведение уже выключено.',
          flags: MessageFlags.Ephemeral | MessageFlags.SuppressNotifications,
        });
        return;
      }
      queue.toggleAutoplay();
      await interaction.update({ components: components.playerRows(queue) });
      return;
    }

    case components.IDS.skip: {
      const track = queue.skip();
      await interaction.reply({
        content: `${interaction.user} пропустил **${track.title.slice(0, 80)}**`,
        flags: MessageFlags.SuppressNotifications,
      });
      return;
    }

    case components.IDS.stop: {
      await queue.stop();
      await interaction.reply({
        content: `${interaction.user} остановил воспроизведение.`,
        flags: MessageFlags.SuppressNotifications,
      });
      return;
    }

    case components.IDS.queue: {
      const { embed, page, totalPages } = embeds.queueList(queue, 1);
      await interaction.reply({
        embeds: [embed],
        components: totalPages > 1 ? [components.queueRow(page, totalPages)] : [],
        flags: MessageFlags.Ephemeral | MessageFlags.SuppressNotifications,
      });
      return;
    }

    case components.IDS.queuePrev:
    case components.IDS.queueNext: {
      const currentPage = Number.parseInt(interaction.customId.split(':')[2], 10) || 1;
      const target = key === components.IDS.queueNext ? currentPage + 1 : currentPage - 1;
      const { embed, page, totalPages } = embeds.queueList(queue, target);

      await interaction.update({ embeds: [embed], components: [components.queueRow(page, totalPages)] });
      return;
    }

    default:
      await interaction.deferUpdate().catch(() => {});
  }
}

module.exports = {
  name: Events.InteractionCreate,

  async execute(client, interaction) {
    if (!interaction.isButton() || !interaction.inGuild()) return;

    try {
      await handleButton(client, interaction);
    } catch (error) {
      if (!error?.isUserError) logger.error('Ошибка обработки кнопки:', error);

      const payload = {
        embeds: [embeds.error(toUserMessage(error))],
        flags: MessageFlags.Ephemeral | MessageFlags.SuppressNotifications,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
