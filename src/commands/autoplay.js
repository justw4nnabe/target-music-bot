'use strict';

const embeds = require('../ui/embeds');

module.exports = {
  name: 'autoplay',
  aliases: ['auto play toggle', 'autoplaytoggle', 'autoplay toggle', 'автоплей'],
  description: 'Включить или выключить автовоспроизведение похожих треков при окончании очереди',
  usage: '[toggle]',
  requiresVoice: true,
  requiresSameChannel: true,

  async execute({ message, queues, reply }) {
    const queue = queues.ensure({ guild: message.guild, textChannel: message.channel });
    const isEnabled = queue.toggleAutoplay();
    await queue.refreshNowPlaying();

    if (isEnabled) {
      await reply(
        embeds.success(
          'Автовоспроизведение **включено**.\nКогда треки в очереди закончатся, бот автоматически продолжит играть похожую музыку.',
        ),
      );
    } else {
      await reply(
        embeds.info(
          'Автовоспроизведение **выключено**.\nПосле завершения очереди бот остановится.',
        ),
      );
    }
  },
};
