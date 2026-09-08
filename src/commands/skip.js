'use strict';

const { PermissionFlagsBits } = require('discord.js');
const embeds = require('../ui/embeds');
const { truncate } = require('../utils/format');

module.exports = {
  name: 'skip',
  aliases: ['s', 'скип'],
  description: 'Пропустить текущий трек (автор трека пропускает сразу, остальные начинают голосование)',
  usage: '',
  requiresVoice: true,
  requiresSameChannel: true,
  requiresQueue: true,

  async execute({ message, queue, reply, prefix, voiceChannel }) {
    if (!queue.current) {
      await reply(embeds.warning('Сейчас ничего не играет.'));
      return;
    }

    const currentTrack = queue.current;
    const authorId = message.author.id;
    const isRequester = currentTrack.requestedBy?.id === authorId;
    const isAdmin =
      message.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
      message.member?.permissions?.has(PermissionFlagsBits.Administrator);

    const listeners = voiceChannel?.members?.filter((member) => !member.user.bot) ?? new Map();

    if (isRequester || isAdmin || listeners.size <= 1) {
      const skipped = queue.skip();
      const byWhom = isRequester ? 'автором трека' : (isAdmin ? 'администратором' : '');
      await reply(embeds.success(`Пропущено ${byWhom ? `(${byWhom})` : ''}: **${truncate(skipped.title, 70)}**`));
      return;
    }

    const requiredVotes = Math.ceil(listeners.size / 2);

    if (queue.skipVotes.has(authorId)) {
      await reply(
        embeds.info(`Ты уже проголосовал за пропуск (**${queue.skipVotes.size}/${requiredVotes}** голосов).`),
      );
      return;
    }

    queue.skipVotes.add(authorId);

    if (queue.skipVotes.size >= requiredVotes) {
      const skipped = queue.skip();
      await reply(
        embeds.success(
          `Голосование успешно (**${requiredVotes}/${requiredVotes}** голосов)! Пропущено: **${truncate(skipped.title, 70)}**`,
        ),
      );
    } else {
      await reply(
        embeds.info(
          `Голос за пропуск трека принят (**${queue.skipVotes.size}/${requiredVotes}** голосов).\n` +
            `Напишите \`${prefix}skip\`, чтобы поддержать пропуск.`,
        ),
      );
    }
  },
};
