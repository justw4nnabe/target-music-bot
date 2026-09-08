'use strict';

const embeds = require('../ui/embeds');

module.exports = {
  name: 'help',
  aliases: ['h', 'commands', 'bot commands', 'botcommands', 'помощь', 'команды'],
  description: 'Список всех команд или справка по конкретной команде',
  usage: '[команда]',

  async execute({ client, args, reply, prefix }) {
    const target = (args[0] ?? '').trim().toLowerCase();

    if (target) {
      const resolvedName = client.commands.has(target) ? target : client.aliases.get(target);
      const command = resolvedName ? client.commands.get(resolvedName) : null;

      if (!command) {
        await reply(embeds.warning(`Команда «**${target}**» не найдена. Напиши **${prefix}help** для списка всех команд.`));
        return;
      }

      await reply(embeds.commandHelp(command, prefix));
      return;
    }

    const list = [...client.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
    await reply(embeds.help(list, prefix));
  },
};
