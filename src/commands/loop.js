'use strict';

const repeatCommand = require('./repeat');

module.exports = {
  name: 'loop',
  aliases: [],
  description: 'Алиас команды repeat (режимы current, queue, off)',
  usage: '[current|queue|off]',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute(context) {
    return repeatCommand.execute(context);
  },
};
