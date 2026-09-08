'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');

module.exports = {
  name: 'volume',
  aliases: ['vol', 'v', 'громкость'],
  description: 'Показать или изменить громкость (0-100)',
  usage: '[0-100]',
  requiresQueue: true,

  async execute({ queue, args, reply, prefix }) {
    if (!args.length) {
      await reply(embeds.info(`🔊 Текущая громкость: **${queue.volume}%**\nИзменить: \`${prefix}volume 40\``));
      return;
    }

    const value = Number.parseInt(args[0], 10);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new UserError('Громкость задаётся числом от 0 до 100.');
    }

    const volume = queue.setVolume(value);
    const icon = volume === 0 ? '🔇' : volume < 40 ? '🔉' : '🔊';
    await reply(embeds.success(`${icon} Громкость: **${volume}%**`));
  },
};
