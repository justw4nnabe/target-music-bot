'use strict';

const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const config = require('../../config');
const embeds = require('../ui/embeds');
const logger = require('../utils/logger');
const { UserError, toUserMessage } = require('../utils/errors');

const cooldowns = new Map();

function onCooldown(userId) {
  const now = Date.now();
  const last = cooldowns.get(userId) ?? 0;

  if (now - last < config.commandCooldownMs) return true;

  cooldowns.set(userId, now);
  if (cooldowns.size > 500) {
    for (const [id, stamp] of cooldowns) {
      if (now - stamp > 60000) cooldowns.delete(id);
    }
  }
  return false;
}

function parseInvocation(client, content) {
  const prefix = config.prefix;

  if (content.toLowerCase().startsWith(prefix.toLowerCase())) {
    return content.slice(prefix.length).trim();
  }

  const mention = content.match(new RegExp(`^<@!?${client.user.id}>`));
  if (mention) return content.slice(mention[0].length).trim();

  return null;
}

function assertVoiceAccess(message, voiceChannel) {
  const me = message.guild.members.me;
  const permissions = voiceChannel.permissionsFor(me);

  if (!permissions?.has(PermissionFlagsBits.Connect)) {
    throw new UserError(`У меня нет права подключаться к **${voiceChannel.name}**.`);
  }

  if (!permissions.has(PermissionFlagsBits.Speak)) {
    throw new UserError(`У меня нет права говорить в **${voiceChannel.name}**.`);
  }

  if (voiceChannel.full && !permissions.has(PermissionFlagsBits.MoveMembers)) {
    throw new UserError(`Канал **${voiceChannel.name}** заполнен.`);
  }
}

module.exports = {
  name: Events.MessageCreate,

  async execute(client, message) {
    if (message.author.bot || !message.guild || !message.content) return;

    const body = parseInvocation(client, message.content.trim());
    if (!body) return;

    const parts = body.split(/\s+/);
    const invoked = parts.shift().toLowerCase();
    if (!invoked) return;

    const resolvedName = client.commands.has(invoked) ? invoked : client.aliases.get(invoked);
    const command = resolvedName ? client.commands.get(resolvedName) : null;
    if (!command) return;

    const channelPermissions = message.channel.permissionsFor(message.guild.members.me);
    if (!channelPermissions?.has(PermissionFlagsBits.SendMessages)) return;
    if (!channelPermissions.has(PermissionFlagsBits.EmbedLinks)) {
      await message.channel.send('Мне нужно право «Встраивать ссылки» (Embed Links), иначе я не могу отвечать.').catch(() => {});
      return;
    }

    if (onCooldown(message.author.id)) {
      return;
    }

    const reply = async (payload) => {
      const data = payload instanceof EmbedBuilder ? { embeds: [payload] } : payload;
      const options = { ...data, allowedMentions: { repliedUser: false } };
      return message.reply(options).catch(() => message.channel.send(data).catch(() => null));
    };

    try {
      const voiceChannel = message.member?.voice?.channel ?? null;
      const botChannelId = message.guild.members.me?.voice?.channelId ?? null;
      const queue = client.queues.get(message.guild.id);

      if (command.requiresVoice && !voiceChannel) {
        throw new UserError('Сначала зайди в голосовой канал.');
      }

      if (command.requiresSameChannel && voiceChannel && botChannelId && botChannelId !== voiceChannel.id) {
        throw new UserError('Я уже играю в другом голосовом канале — зайди туда.');
      }

      if (command.requiresVoice && voiceChannel) assertVoiceAccess(message, voiceChannel);

      if (command.requiresQueue && (!queue || queue.destroyed || (!queue.current && !queue.tracks.length))) {
        throw new UserError('Сейчас ничего не играет.');
      }

      if (queue) queue.setTextChannel(message.channel);

      await command.execute({
        client,
        message,
        args: parts,
        query: body.slice(invoked.length).trim(),
        prefix: config.prefix,
        queues: client.queues,
        queue,
        voiceChannel,
        reply,
      });

      logger.debug(`[${message.guild.id}] ${message.author.tag}: ${config.prefix}${resolvedName}`);
    } catch (error) {
      if (!error?.isUserError) {
        logger.error(`Ошибка команды ${resolvedName}:`, error);
      }
      await reply(embeds.error(toUserMessage(error))).catch(() => {});
    }
  },
};
