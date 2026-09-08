'use strict';

const skipCommand = require('./skip');

module.exports = {
  name: 'next',
  aliases: ['след', 'следующий'],
  description: 'Перейти к следующему треку в очереди (логика совпадает со skip)',
  usage: '',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute(context) {
    return skipCommand.execute(context);
  },
};
