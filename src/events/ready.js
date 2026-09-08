'use strict';

const { Events, ActivityType } = require('discord.js');

const config = require('../../config');
const logger = require('../utils/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    logger.info(`Бот запущен как ${client.user.tag}`);
    logger.info(`Серверов: ${client.guilds.cache.size} • префикс: ${config.prefix}`);

    client.user.setPresence({
      status: 'online',
      activities: [{ name: `${config.prefix}help`, type: ActivityType.Listening }],
    });
  },
};
