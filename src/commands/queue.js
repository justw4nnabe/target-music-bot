'use strict';

const embeds = require('../ui/embeds');
const components = require('../ui/components');

module.exports = {
  name: 'queue',
  aliases: ['q', 'очередь', 'список'],
  description: 'Показать очередь (страницами по 10)',
  usage: '[страница]',
  requiresQueue: true,

  async execute({ queue, args, reply }) {
    const requested = Number.parseInt(args[0], 10);
    const { embed, page, totalPages } = embeds.queueList(queue, Number.isFinite(requested) ? requested : 1);

    if (totalPages <= 1) {
      await reply(embed);
      return;
    }

    await reply({ embeds: [embed], components: [components.queueRow(page, totalPages)] });
  },
};
