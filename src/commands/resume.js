'use strict';

const embeds = require('../ui/embeds');
const { truncate } = require('../utils/format');

module.exports = {
  name: 'resume',
  aliases: ['unpause', 'продолжить', 'резюм'],
  description: 'Снять трек с паузы',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, reply }) {
    const track = queue.resume();
    await queue.refreshNowPlaying();
    await reply(embeds.success(`▶️ Продолжаю: **${truncate(track.title, 70)}**`));
  },
};
