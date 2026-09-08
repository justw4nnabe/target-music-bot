'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');

module.exports = {
  name: 'leave',
  aliases: ['dc', 'disconnect', 'fuck off', 'fuckoff', 'выйди', 'отключись'],
  description: 'Отключить бота от голосового канала и очистить очередь',
  requiresVoice: true,
  requiresSameChannel: true,

  async execute({ queue, reply }) {
    if (!queue) throw new UserError('Я и так не в голосовом канале.');

    await reply(embeds.success('👋 Вышел из голосового канала.'));
    await queue.destroy('command');
  },
};
