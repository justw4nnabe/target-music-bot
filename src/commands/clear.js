'use strict';

const embeds = require('../ui/embeds');
const { tracksWord } = require('../utils/format');

module.exports = {
  name: 'clear',
  aliases: ['remove all', 'removeall', 'rm all', 'очистить'],
  description: 'Удалить все треки из очереди',
  usage: '',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, reply }) {
    const count = queue.clear();
    if (count === 0) {
      await reply(embeds.info('В очереди и так нет ожидающих треков.'));
      return;
    }

    await reply(embeds.success(`🗑️ Очередь очищена: удалено **${count}** ${tracksWord(count)}.`));
  },
};
