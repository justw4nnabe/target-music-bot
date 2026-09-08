'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const IDS = {
  toggle: 'music:toggle',
  skip: 'music:skip',
  stop: 'music:stop',
  loop: 'music:loop',
  queue: 'music:queue',
  queuePrev: 'queue:prev',
  queueNext: 'queue:next',
};

const LOOP_STYLE = {
  off: ButtonStyle.Secondary,
  track: ButtonStyle.Success,
  queue: ButtonStyle.Primary,
};

const LOOP_EMOJI = {
  off: '🔁',
  track: '🔂',
  queue: '🔁',
};

function playerRow(queue, disabled = false) {
  const paused = Boolean(queue?.paused);
  const loopMode = queue?.loopMode ?? 'off';

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.toggle)
      .setEmoji(paused ? '▶️' : '⏸️')
      .setLabel(paused ? 'Играть' : 'Пауза')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.skip)
      .setEmoji('⏭️')
      .setLabel('Скип')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.stop)
      .setEmoji('⏹️')
      .setLabel('Стоп')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.loop)
      .setEmoji(LOOP_EMOJI[loopMode])
      .setLabel('Повтор')
      .setStyle(LOOP_STYLE[loopMode])
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.queue)
      .setEmoji('📜')
      .setLabel('Очередь')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function queueRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.queuePrev}:${page}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('queue:page')
      .setLabel(`${page}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${IDS.queueNext}:${page}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
  );
}

function searchRow(count = 5) {
  const row = new ActionRowBuilder();
  for (let i = 1; i <= count; i += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`search:select:${i}`)
        .setLabel(String(i))
        .setStyle(ButtonStyle.Primary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId('search:cancel')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

module.exports = { IDS, playerRow, queueRow, searchRow };
