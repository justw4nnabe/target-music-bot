'use strict';

const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');

const config = require('../config');
const logger = require('./utils/logger');
const ffmpeg = require('./services/ffmpeg');
const ytdlp = require('./services/ytdlp');
const { QueueManager } = require('./structures/QueueManager');
const { loadCommands, loadEvents } = require('./utils/loaders');

async function initEncryption() {
  try {
    const sodium = require('libsodium-wrappers');
    await sodium.ready;
    logger.debug('libsodium-wrappers инициализирован');
  } catch {
    logger.debug('libsodium-wrappers недоступен, @discordjs/voice выберет другой пакет шифрования');
  }
}

async function checkDependencies() {
  const version = await ffmpeg.check();
  if (version) logger.info(`ffmpeg найден: ${version}`);
  else logger.warn('ffmpeg не найден! Установи ffmpeg или задай FFMPEG_PATH — без него звука не будет.');

  if (!(await ytdlp.available())) {
    logger.warn('yt-dlp не найден! Запусти `npm run setup` или `pip install -U yt-dlp`.');
  }

  if (!config.spotify.clientId || !config.spotify.clientSecret) {
    logger.warn('Spotify не настроен — ссылки на Spotify работать не будут (YouTube и SoundCloud работают).');
  }
}

async function main() {
  if (!config.token) {
    logger.error('DISCORD_TOKEN не задан. Скопируй .env.example в .env и вставь токен бота.');
    process.exit(1);
  }

  await initEncryption();
  await checkDependencies();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.commands = new Collection();
  client.aliases = new Collection();
  client.queues = new QueueManager(client);

  loadCommands(client, path.join(__dirname, 'commands'));
  loadEvents(client, path.join(__dirname, 'events'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Необработанный rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Необработанное исключение:', error);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Получен ${signal}, останавливаюсь…`);
    await client.queues.destroyAll(signal).catch(() => {});
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await client.login(config.token);
  } catch (error) {
    if (String(error.message).includes('disallowed intents')) {
      logger.error(
        'Discord отклонил вход: не включён привилегированный интент MESSAGE CONTENT. ' +
          'Discord Developer Portal -> твоё приложение -> Bot -> Privileged Gateway Intents -> включи MESSAGE CONTENT INTENT.',
      );
    } else {
      logger.error('Не удалось войти:', error.message);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Критическая ошибка запуска:', error);
  process.exit(1);
});
