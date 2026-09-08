'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const IDS = {
  toggle: 'music:toggle',
  skip: 'music:skip',
  stop: 'music:stop',
  loop: 'music:loop',
  autoplay: 'music:autoplay',
  queue: 'music:queue',
  queuePrev: 'queue:prev',
  queueNext: 'queue:next',
};

const LOOP_STYLE = {
  off: ButtonStyle.Secondary,
  track: ButtonStyle.Success,
  queue: ButtonStyle.Primary,
};

function playerRow(queue, disabled = false) {
  const paused = Boolean(queue?.paused);
  const loopMode = queue?.loopMode ?? 'off';
  const loopLabel = loopMode === 'track' ? 'Повтор: трек' : loopMode === 'queue' ? 'Повтор: очередь' : 'Повтор';

  const isAutoplay = Boolean(queue?.autoplay);
  const current = queue?.current;
  const isOtherTrackWithAutoplay = Boolean(current?.isAutoplay || current?.autoplayActiveOnStart);

  let autoplayLabel = 'Автоплей';
  let autoplayStyle = ButtonStyle.Secondary;
  let autoplayDisabled = disabled;

  if (isAutoplay) {
    autoplayLabel = 'Выкл. автоплей';
    autoplayStyle = ButtonStyle.Success;
  } else if (isOtherTrackWithAutoplay) {
    autoplayLabel = 'Автоплей: выкл';
    autoplayStyle = ButtonStyle.Secondary;
    autoplayDisabled = true;
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.toggle)
      .setLabel(paused ? 'Играть' : 'Пауза')
      .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.skip)
      .setLabel('Скип')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.stop)
      .setLabel('Стоп')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.loop)
      .setLabel(loopLabel)
      .setStyle(LOOP_STYLE[loopMode])
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(IDS.autoplay)
      .setLabel(autoplayLabel)
      .setStyle(autoplayStyle)
      .setDisabled(autoplayDisabled),
  );
}

function playerRows(queue, disabled = false) {
  return [playerRow(queue, disabled)];
}

function queueRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.queuePrev}:${page}`)
      .setLabel('Назад')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId('queue:page')
      .setLabel(`${page}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${IDS.queueNext}:${page}`)
      .setLabel('Вперёд')
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
      .setLabel('Отмена')
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

module.exports = { IDS, playerRows, playerRow, queueRow, searchRow };
