'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');
const { parseDuration, formatDuration, truncate } = require('../utils/format');

module.exports = {
  name: 'seek',
  aliases: ['перемотка', 'мотать'],
  description: 'Перемотать текущий трек на указанное время',
  usage: '<1:23 | 83 | 1m23s>',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, query, reply, prefix }) {
    if (!query) throw new UserError(`Укажи время. Например: \`${prefix}seek 1:30\` или \`${prefix}seek 90\``);

    const seconds = parseDuration(query);
    if (seconds === null) {
      throw new UserError('Не понял формат времени. Поддерживается `1:30`, `90`, `1m30s`.');
    }

    const track = queue.current;
    const position = await queue.seek(seconds);
    await reply(
      embeds.success(`⏩ Перемотал **${truncate(track.title, 60)}** на \`${formatDuration(position)}\`.`),
    );
  },
};
