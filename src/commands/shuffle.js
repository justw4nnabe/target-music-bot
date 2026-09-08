'use strict';

const embeds = require('../ui/embeds');
const { tracksWord } = require('../utils/format');

module.exports = {
  name: 'shuffle',
  aliases: ['sh', 'перемешать', 'шафл'],
  description: 'Перемешать очередь',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, reply }) {
    const count = queue.shuffle();
    await reply(embeds.success(`🔀 Перемешал ${count} ${tracksWord(count)} в очереди.`));
  },
};
