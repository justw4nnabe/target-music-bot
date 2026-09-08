'use strict';

const { MusicQueue } = require('./MusicQueue');
const logger = require('../utils/logger');

class QueueManager {
  constructor(client) {
    this.client = client;
    this.queues = new Map();
  }

  get size() {
    return this.queues.size;
  }

  get(guildId) {
    return this.queues.get(guildId) ?? null;
  }

  has(guildId) {
    return this.queues.has(guildId);
  }

  ensure({ guild, textChannel }) {
    const existing = this.queues.get(guild.id);
    if (existing && !existing.destroyed) {
      existing.setTextChannel(textChannel);
      return existing;
    }

    const queue = new MusicQueue({ client: this.client, guild, textChannel, manager: this });
    this.queues.set(guild.id, queue);
    logger.debug(`[${guild.id}] Создана новая очередь`);
    return queue;
  }

  delete(guildId) {
    return this.queues.delete(guildId);
  }

  async destroyAll(reason = 'shutdown') {
    const queues = [...this.queues.values()];
    await Promise.allSettled(queues.map((queue) => queue.destroy(reason)));
    this.queues.clear();
  }
}

module.exports = { QueueManager };
