'use strict';

const embeds = require('../ui/embeds');

module.exports = {
  name: 'stop',
  aliases: ['стоп'],
  description: 'Остановить воспроизведение и очистить очередь',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, reply }) {
    await queue.stop();
    await reply(embeds.success('⏹️ Воспроизведение остановлено, очередь очищена.'));
  },
};
