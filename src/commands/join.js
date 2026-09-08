'use strict';

const embeds = require('../ui/embeds');

module.exports = {
  name: 'join',
  aliases: ['подключись', 'зайди'],
  description: 'Подключить бота к твоему голосовому каналу',
  requiresVoice: true,
  requiresSameChannel: true,

  async execute({ message, queues, voiceChannel, reply }) {
    const queue = queues.ensure({ guild: message.guild, textChannel: message.channel });
    await queue.connect(voiceChannel);
    if (queue.isEmpty) queue.scheduleIdleLeave();

    await reply(embeds.success(`🎧 Подключился к **${voiceChannel.name}**.`));
  },
};
