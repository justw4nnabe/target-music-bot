'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger');

function jsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith('.js')).map((file) => path.resolve(dir, file));
}

function loadCommands(client, dir) {
  for (const file of jsFiles(dir)) {
    const command = require(file);
    if (!command?.name || typeof command.execute !== 'function') {
      logger.warn(`Пропущен некорректный файл команды: ${path.basename(file)}`);
      continue;
    }

    client.commands.set(command.name, command);
    for (const alias of command.aliases ?? []) client.aliases.set(alias, command.name);
    logger.debug(`Команда загружена: ${command.name}`);
  }

  logger.info(`Загружено команд: ${client.commands.size}`);
}

function loadEvents(client, dir) {
  let count = 0;

  for (const file of jsFiles(dir)) {
    const event = require(file);
    if (!event?.name || typeof event.execute !== 'function') {
      logger.warn(`Пропущен некорректный файл события: ${path.basename(file)}`);
      continue;
    }

    const handler = (...args) => event.execute(client, ...args);
    if (event.once) client.once(event.name, handler);
    else client.on(event.name, handler);

    count += 1;
    logger.debug(`Событие загружено: ${event.name}`);
  }

  logger.info(`Загружено событий: ${count}`);
}

module.exports = { loadCommands, loadEvents };
