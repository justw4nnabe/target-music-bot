'use strict';

const embeds = require('../ui/embeds');
const { truncate } = require('../utils/format');

module.exports = {
  name: 'pause',
  aliases: ['пауза'],
  description: 'Поставить текущий трек на паузу',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, reply }) {
    const track = queue.pause();
    await queue.refreshNowPlaying();
    await reply(embeds.success(`⏸️ Пауза: **${truncate(track.title, 70)}**`));
  },
};
