'use strict';

const embeds = require('../ui/embeds');
const components = require('../ui/components');
const { UserError } = require('../utils/errors');

module.exports = {
  name: 'nowplaying',
  aliases: ['np', 'сейчас', 'текущий'],
  description: 'Показать текущий трек с прогресс-баром',
  requiresQueue: true,

  async execute({ queue, reply }) {
    if (!queue.current) throw new UserError('Сейчас ничего не играет.');
    await reply({ embeds: [embeds.nowPlaying(queue)], components: components.playerRows(queue) });
  },
};
