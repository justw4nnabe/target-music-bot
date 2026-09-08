'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');
const { truncate } = require('../utils/format');

module.exports = {
  name: 'remove',
  aliases: ['rm', 'del', 'убрать', 'удалить'],
  description: 'Убрать трек из очереди по номеру',
  usage: '<позиция>',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, args, reply, prefix }) {
    const position = Number.parseInt(args[0], 10);
    if (!Number.isFinite(position)) {
      throw new UserError(`Укажи номер трека из \`${prefix}queue\`. Например: \`${prefix}remove 3\``);
    }

    const track = queue.remove(position);
    await reply(embeds.success(`Убрал из очереди: **${truncate(track.title, 70)}**`));
  },
};
