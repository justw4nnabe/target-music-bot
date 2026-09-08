'use strict';

const { Events } = require('discord.js');
const logger = require('../utils/logger');

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(client, oldState, newState) {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;

    const queue = client.queues.get(guild.id);
    if (!queue || queue.destroyed) return;

    if (oldState.id === client.user.id) {
      if (!newState.channelId) {
        logger.info(`[${guild.id}] Бота отключили от голосового канала`);
        await queue.destroy('voice-kick');
        return;
      }

      if (oldState.channelId !== newState.channelId) {
        queue.voiceChannelId = newState.channelId;
        logger.info(`[${guild.id}] Бота перенесли в другой канал`);
      }
    }

    const botChannelId = guild.members.me?.voice?.channelId;
    if (!botChannelId) return;

    const channel = guild.channels.cache.get(botChannelId);
    if (!channel) return;

    const listeners = channel.members.filter((member) => !member.user.bot).size;
    if (listeners === 0) queue.startEmptyChannelTimer();
    else queue.cancelEmptyChannelTimer();
  },
};
