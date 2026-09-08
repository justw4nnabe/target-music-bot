'use strict';

const embeds = require('../ui/embeds');
const { UserError } = require('../utils/errors');

const ALIASES = {
  off: 'off',
  disable: 'off',
  disabled: 'off',
  выкл: 'off',
  выключить: 'off',
  none: 'off',
  '0': 'off',

  current: 'track',
  track: 'track',
  трек: 'track',
  song: 'track',
  one: 'track',
  '1': 'track',

  queue: 'queue',
  all: 'queue',
  очередь: 'queue',
  q: 'queue',
};

const LABELS = {
  off: 'Повтор выключен.',
  track: 'Повторяю текущий трек.',
  queue: 'Повторяю всю очередь.',
};

module.exports = {
  name: 'repeat',
  aliases: [
    'repeatcurrent',
    'repeatqueue',
    'repeatdisable',
    'repeatoff',
    'повтор',
  ],
  description: 'Режим повтора: current (текущий трек), queue (вся очередь), disable/off (выключить)',
  usage: '[current|queue|disable]',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ queue, args, reply }) {
    if (!args.length) {
      const mode = queue.cycleLoop();
      await queue.refreshNowPlaying();
      await reply(embeds.success(LABELS[mode]));
      return;
    }

    const requested = ALIASES[args[0].toLowerCase()];
    if (!requested) {
      throw new UserError('Доступные режимы: `current` (текущий трек), `queue` (очередь), `disable` (выключить).');
    }

    const mode = queue.setLoop(requested);
    await queue.refreshNowPlaying();
    await reply(embeds.success(LABELS[mode]));
  },
};
