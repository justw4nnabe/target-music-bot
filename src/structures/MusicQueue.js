'use strict';

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  VoiceConnectionDisconnectReason,
} = require('@discordjs/voice');

const { EmbedBuilder, MessageFlags } = require('discord.js');

const config = require('../../config');
const logger = require('../utils/logger');
const embeds = require('../ui/embeds');
const components = require('../ui/components');
const ffmpeg = require('../services/ffmpeg');
const resolver = require('../services/resolver');
const youtube = require('../services/sources/youtube');
const { UserError, toUserMessage } = require('../utils/errors');
const { truncate } = require('../utils/format');

const LOOP_MODES = ['off', 'track', 'queue'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractArtist(track) {
  const title = track?.title || '';
  if (title.includes(' - ')) {
    const fromTitle = title.split(' - ')[0].trim().replace(/^\[.*?\]\s*|\(.*?\)/g, '').trim();
    if (fromTitle && fromTitle.length < 35 && !/^(?:official|music|video|audio|remix|ft|feat)/i.test(fromTitle)) {
      return fromTitle;
    }
  }
  const author = track?.author || '';
  if (author && author !== 'YouTube' && author !== 'SoundCloud' && !/vevo|topic|records|music|lemonade/i.test(author)) {
    return author;
  }
  return author || '';
}

async function getSimilarArtists(artist) {
  if (!artist || artist === 'YouTube' || artist === 'SoundCloud') return [];
  try {
    const cleanArtist = artist.split(/[,&x/]/)[0].trim();
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(cleanArtist)}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json&limit=12`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.similarartists?.artist || []).map((a) => a.name).filter(Boolean);
  } catch {
    return [];
  }
}

class MusicQueue {
  constructor({ client, guild, textChannel, manager }) {
    this.client = client;
    this.guild = guild;
    this.guildId = guild.id;
    this.textChannel = textChannel;
    this.manager = manager;

    this.tracks = [];
    this.current = null;
    this.lastPlayedTrack = null;
    this.playedHistory = [];
    this.recentAuthors = [];
    this.autoplay = false;
    this.skipVotes = new Set();
    this.volume = config.player.defaultVolume;
    this.loopMode = 'off';

    this.connection = null;
    this.subscription = null;
    this.voiceChannelId = null;
    this.resource = null;
    this.streamHandle = null;
    this.seekOffset = 0;

    this.destroyed = false;
    this.advancing = false;
    this.idleAction = 'advance';
    this.manualSkip = false;
    this.idleTimer = null;
    this.emptyChannelTimer = null;
    this.nowPlayingMessage = null;

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
        maxMissedFrames: 250,
      },
    });

    this.player.on('stateChange', (oldState, newState) => {
      logger.info(`[${this.guildId}] Состояние плеера: ${oldState.status} -> ${newState.status}`);
    });
    this.player.on(AudioPlayerStatus.Idle, () => this.handleIdle());
    this.player.on('error', (error) => this.handlePlayerError(error));
    this.player.on(AudioPlayerStatus.Playing, () => {
      logger.info(`[${this.guildId}] Плеер: воспроизведение началось`);
    });
  }

  get paused() {
    const status = this.player.state.status;
    return status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
  }

  get playing() {
    return Boolean(this.current) && this.player.state.status !== AudioPlayerStatus.Idle;
  }

  get isEmpty() {
    return !this.current && this.tracks.length === 0;
  }

  getPosition() {
    if (!this.current) return 0;
    const played = this.resource ? this.resource.playbackDuration / 1000 : 0;
    return Math.max(0, Math.floor(this.seekOffset + played));
  }

  async send(payload) {
    if (!this.textChannel) return null;
    try {
      const body = payload instanceof EmbedBuilder ? { embeds: [payload] } : { ...payload };
      if (Array.isArray(body?.components)) {
        body.components = body.components.flat();
      }
      body.flags = (body.flags || 0) | MessageFlags.SuppressNotifications;
      return await this.textChannel.send(body);
    } catch (error) {
      logger.warn(`[${this.guildId}] Не удалось отправить сообщение: ${error.message}`);
      return null;
    }
  }

  setTextChannel(channel) {
    if (channel) this.textChannel = channel;
  }

  async connect(voiceChannel) {
    const existing = getVoiceConnection(this.guildId);

    if (existing) {
      if (existing.joinConfig?.channelId === voiceChannel.id && existing.state.status === VoiceConnectionStatus.Ready) {
        this.connection = existing;
        this.voiceChannelId = voiceChannel.id;
        this.subscription = this.connection.subscribe(this.player);
        return;
      }
      try {
        existing.destroy();
      } catch {}
    }

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
      debug: true,
    });

    this.voiceChannelId = voiceChannel.id;
    this.attachConnectionHandlers(this.connection);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, config.player.connectionTimeoutMs);
    } catch (error) {
      const currentStatus = this.connection?.state?.status ?? 'unknown';
      logger.warn(`[${this.guildId}] Подключение к голосовому каналу не удалось (статус: ${currentStatus}): ${error.message}`);
      try {
        this.connection.destroy();
      } catch {}
      this.connection = null;
      throw new UserError('Не удалось подключиться к голосовому каналу (таймаут ответа Discord). Проверь права роли бота (Администратор) и попробуй сменить регион голосового канала на Роттердам/Франкфурт.');
    }

    if (this.subscription) {
      try {
        this.subscription.unsubscribe();
      } catch {}
    }
    this.subscription = this.connection.subscribe(this.player);
    logger.info(`[${this.guildId}] Подключился к каналу ${voiceChannel.name} и подписал плеер`);
  }

  attachConnectionHandlers(connection) {
    connection.on('stateChange', (oldState, newState) => {
      logger.info(`[${this.guildId}] Состояние голосового соединения: ${oldState.status} -> ${newState.status}`);
    });

    connection.on('error', (error) => {
      logger.warn(`[${this.guildId}] Ошибка голосового соединения: ${error.message}`);
    });

    connection.on('debug', (message) => {
      logger.info(`[${this.guildId}] [Voice Debug] ${message}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async (_old, newState) => {
      if (this.destroyed) return;

      const movedByRegion =
        newState.reason === VoiceConnectionDisconnectReason.WebSocketClose && newState.closeCode === 4014;

      if (movedByRegion) {
        try {
          await entersState(connection, VoiceConnectionStatus.Connecting, 5000);
          logger.info(`[${this.guildId}] Соединение восстанавливается после смены региона`);
        } catch {
          logger.info(`[${this.guildId}] Бота отключили от канала`);
          await this.destroy('disconnected');
        }
        return;
      }

      if (connection.rejoinAttempts < 5) {
        await sleep((connection.rejoinAttempts + 1) * 1500);
        if (this.destroyed) return;
        logger.info(`[${this.guildId}] Переподключение (попытка ${connection.rejoinAttempts + 1})`);
        connection.rejoin();
        return;
      }

      await this.send(embeds.warning('Соединение с голосовым каналом потеряно — выхожу.'));
      await this.destroy('rejoin-failed');
    });
  }

  enqueue(tracks) {
    const free = Math.max(0, config.queue.maxSize - this.tracks.length);
    const accepted = tracks.slice(0, free);
    this.tracks.push(...accepted);
    this.preResolveQueue();
    return { added: accepted.length, skipped: tracks.length - accepted.length };
  }

  preResolveQueue() {
    for (const track of this.tracks) {
      if (track.source === 'soundcloud' && (!track.duration || track.url?.includes('api-v2.soundcloud.com'))) {
        const soundcloud = require('../services/sources/soundcloud');
        soundcloud.resolveTrack(track).catch(() => {});
        break;
      }
    }
  }

  enqueueNext(track) {
    if (this.tracks.length >= config.queue.maxSize) return false;
    this.tracks.unshift(track);
    return true;
  }

  pickNext() {
    if (this.loopMode === 'track' && this.current) return this.current;
    if (this.loopMode === 'queue' && this.current) this.tracks.push(this.current);
    return this.tracks.shift() ?? null;
  }

  async start() {
    if (this.current || this.advancing) return;
    await this.advance();
  }

  async advance() {
    if (this.destroyed || this.advancing) return;

    this.advancing = true;
    this.clearIdleTimer();

    try {
      let guard = 0;

      while (!this.destroyed && guard < 25) {
        guard += 1;

        let next = this.pickNext();
        if (!next) {
          if (this.autoplay && this.lastPlayedTrack) {
            next = await this.fetchAutoplayTrack();
          }
        }

        if (!next) {
          this.current = null;
          this.releaseStream();
          await this.handleQueueEnd();
          return;
        }

        this.current = next;
        const started = await this.tryStart(next, 0);
        if (started) return;

        this.current = null;
        if (this.loopMode === 'track') this.loopMode = 'off';
      }
    } catch (error) {
      logger.error(`[${this.guildId}] Ошибка при переходе к следующему треку:`, error);
      await this.send(embeds.error(toUserMessage(error)));
    } finally {
      this.advancing = false;
    }
  }

  async tryStart(track, seekSeconds) {
    for (let attempt = 0; attempt <= config.player.maxStreamRetries; attempt += 1) {
      try {
        await this.playResource(track, seekSeconds);
        this.lastPlayedTrack = track;
        if (track.url) {
          this.playedHistory.push(track.url);
          if (this.playedHistory.length > 50) this.playedHistory.shift();
        }
        const artist = extractArtist(track);
        if (artist) {
          const authorKey = artist.toLowerCase().trim();
          this.recentAuthors = this.recentAuthors.filter((a) => a !== authorKey);
          this.recentAuthors.push(authorKey);
          if (this.recentAuthors.length > 10) this.recentAuthors.shift();
        }
        this.skipVotes.clear();
        this.clearIdleTimer();
        this.preResolveQueue();
        return true;
      } catch (error) {
        track.cachedStream = null;
        logger.warn(
          `[${this.guildId}] Не удалось запустить «${track.title}» (попытка ${attempt + 1}): ${error.message}`,
        );

        if (attempt === config.player.maxStreamRetries) {
          await this.send(
            embeds.error(`Не удалось включить «${truncate(track.title, 70)}» — ${toUserMessage(error)}`),
          );
          return false;
        }

        await sleep(700);
      }
    }

    return false;
  }

  async playResource(track, seekSeconds) {
    let streamInfo = await resolver.getStream(track);

    this.idleAction = 'ignore';
    try {
      this.player.stop(true);
    } catch {}
    this.releaseStream();

    let handle;
    try {
      handle = await ffmpeg.createPcmStream({
        url: streamInfo.url,
        headers: streamInfo.headers,
        seek: seekSeconds,
        isYouTube: track.source === 'youtube' || Boolean(streamInfo.isYouTube),
        targetUrl: streamInfo.targetUrl || track.playbackUrl || track.url,
      });

      await handle.waitForStart(config.player.streamStartTimeoutMs);
    } catch (error) {
      if (handle) handle.kill();

      if (track.source === 'youtube' && !track.fallbackAttempted) {
        track.fallbackAttempted = true;
        logger.warn(`[${this.guildId}] Ошибка воспроизведения YouTube для «${track.title}», пробую SoundCloud…`);
        try {
          const soundcloud = require('../services/sources/soundcloud');
          const author = track.author && track.author !== 'YouTube' && track.author !== 'SoundCloud' ? track.author : '';
          const scQuery = author && !track.title.toLowerCase().includes(author.toLowerCase())
            ? `${track.title} ${author}`.trim()
            : track.title;
          const scResults = await soundcloud.search(scQuery, track.requestedBy, 1);
          if (scResults && scResults[0]) {
            logger.info(`[${this.guildId}] Найдена копия на SoundCloud, переключаю поток…`);
            const scStream = await soundcloud.fetchStream(scResults[0]);
            handle = await ffmpeg.createPcmStream({
              url: scStream.url,
              headers: scStream.headers,
              seek: seekSeconds,
              isYouTube: false,
            });
            await handle.waitForStart(config.player.streamStartTimeoutMs);
          } else {
            this.idleAction = 'advance';
            throw error;
          }
        } catch (scErr) {
          if (handle) handle.kill();
          this.idleAction = 'advance';
          throw error;
        }
      } else {
        this.idleAction = 'advance';
        throw error;
      }
    }

    const resource = createAudioResource(handle.stream, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: track,
    });

    resource.volume?.setVolumeLogarithmic(this.volume / 100);

    this.streamHandle = handle;
    this.resource = resource;
    this.seekOffset = seekSeconds;

    this.player.play(resource);
    this.idleAction = 'advance';

    if (seekSeconds === 0) await this.announce(track);
    else await this.refreshNowPlaying();
  }

  async announce(track) {
    if (this.destroyed) return;

    if (this.autoplay) {
      track.autoplayActiveOnStart = true;
    }

    await this.retireNowPlaying();
    const message = await this.send({ embeds: [embeds.trackStarted(track)], components: components.playerRows(this) });
    this.nowPlayingMessage = message;
  }

  async refreshNowPlaying() {
    if (!this.nowPlayingMessage || this.destroyed) return;
    try {
      await this.nowPlayingMessage.edit({ components: components.playerRows(this) });
    } catch {
      this.nowPlayingMessage = null;
    }
  }

  async retireNowPlaying() {
    const message = this.nowPlayingMessage;
    this.nowPlayingMessage = null;
    if (!message) return;

    try {
      await message.edit({ components: components.playerRows(this, true) });
    } catch {}
  }

  handleIdle() {
    if (this.destroyed) return;

    if (this.idleAction === 'ignore') {
      logger.debug(`[${this.guildId}] Idle проигнорирован (управляемая остановка)`);
      return;
    }

    if (this.manualSkip) {
      this.manualSkip = false;
      logger.debug(`[${this.guildId}] Ручной пропуск трека`);
      this.releaseStream();
      this.advance().catch((error) => logger.error(`[${this.guildId}] advance:`, error));
      return;
    }

    // Check if the track dropped prematurely mid-playback
    const current = this.current;
    if (current) {
      const duration = Number(current.duration) || 0;
      const position = this.getPosition();
      const isPremature =
        (duration > 15 && position < Math.max(0, duration - 8)) ||
        (duration === 0 && position < 10);

      if (isPremature) {
        current._streamDropRetries = (current._streamDropRetries || 0) + 1;
        if (current._streamDropRetries <= 2) {
          logger.warn(
            `[${this.guildId}] Воспроизведение «${current.title}» неожиданно оборвалось на ${position}с из ${duration}с. Восстанавливаю поток (попытка ${current._streamDropRetries})…`,
          );
          this.releaseStream();
          current.cachedStream = null;
          const resumeSeek = Math.max(0, position - 1);
          this.tryStart(current, resumeSeek)
            .then((resumed) => {
              if (!resumed) {
                logger.warn(`[${this.guildId}] Не удалось восстановить поток «${current.title}», перехожу дальше`);
                this.advance().catch((err) => logger.error(`[${this.guildId}] advance:`, err));
              }
            })
            .catch((err) => {
              logger.error(`[${this.guildId}] Ошибка восстановления потока:`, err);
              this.advance().catch((e) => logger.error(`[${this.guildId}] advance:`, e));
            });
          return;
        }
      }
    }

    logger.debug(`[${this.guildId}] Трек закончился, беру следующий`);
    this.releaseStream();
    this.advance().catch((error) => logger.error(`[${this.guildId}] advance:`, error));
  }

  async handlePlayerError(error) {
    logger.error(`[${this.guildId}] Ошибка плеера: ${error.message}`);
    const stderr = this.streamHandle?.stderr;
    if (stderr) logger.debug(`[${this.guildId}] ffmpeg stderr: ${stderr.slice(-500)}`);

    if (this.idleAction === 'ignore') {
      logger.debug(`[${this.guildId}] Ошибка плеера проигнорирована (управляемая смена трека/перемотка)`);
      return;
    }

    // If stream drop recovery is available, let handleIdle attempt recovery before alerting the user
    const current = this.current;
    if (current && (!current._streamDropRetries || current._streamDropRetries < 2)) {
      return;
    }

    if (this.current) {
      await this.send(
        embeds.warning(`Проблема с воспроизведением «${truncate(this.current.title, 70)}» — переключаюсь дальше.`),
      );
    }
  }

  async handleQueueEnd() {
    await this.retireNowPlaying();
    await this.send(embeds.info('Очередь закончилась. Добавь ещё треков или я выйду из канала через несколько минут.'));
    this.scheduleIdleLeave();
  }

  async fetchAutoplayTrack() {
    try {
      let base = this.lastPlayedTrack;
      if (!base) return null;

      const soundcloud = require('../services/sources/soundcloud');

      const requestedBy = {
        id: this.client.user.id,
        displayName: 'Автовоспроизведение',
        tag: 'Autoplay',
      };

      // 1. If base track was from YouTube or another non-SoundCloud source, find its counterpart on SoundCloud
      if (base.source !== 'soundcloud') {
        const cleanArtist = extractArtist(base);
        const cleanTitle = (base.title || '')
          .replace(/\(.*?\)|\[.*?\]/g, '')
          .replace(/official\s*(?:music\s*)?video/i, '')
          .replace(/official\s*audio/i, '')
          .replace(/video\s*clip/i, '')
          .replace(/клип/i, '')
          .trim();
        const scQuery =
          cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())
            ? `${cleanArtist} ${cleanTitle}`
            : cleanTitle || base.title;

        logger.info(
          `[${this.guildId}] Автоплей: трек был из источника «${base.source}», ищу оригинал на SoundCloud: «${scQuery}»`,
        );

        try {
          const scMatches = await soundcloud.search(scQuery, requestedBy, 3);
          if (scMatches && scMatches[0]) {
            base = scMatches[0];
          } else if (cleanArtist) {
            const scArtistMatches = await soundcloud.search(cleanArtist, requestedBy, 3);
            if (scArtistMatches && scArtistMatches[0]) base = scArtistMatches[0];
          }
        } catch (err) {
          logger.debug(`[${this.guildId}] Не удалось найти SoundCloud-аналог для YouTube-трека: ${err.message}`);
        }
      }

      // If base SoundCloud track is unresolved, resolve its metadata first
      if (
        base.source === 'soundcloud' &&
        (!base.title || base.title === 'Без названия' || base.url?.includes('api-v2.soundcloud.com') || !base.duration)
      ) {
        try {
          await soundcloud.resolveTrack(base);
        } catch {}
      }

      const baseArtist = extractArtist(base);
      logger.info(
        `[${this.guildId}] Автовоспроизведение: подбираю трек на SoundCloud по стилю «${base.title}» (артист: ${baseArtist || 'неизвестен'})`,
      );

      // 2. Primary Engine: SoundCloud native related tracks (strict genre/vibe consistency)
      let candidates = [];
      try {
        candidates = await soundcloud.getRelatedTracks(base, 20);
        logger.info(`[${this.guildId}] Автоплей: получено ${candidates.length} похожих треков из SoundCloud`);
      } catch (err) {
        logger.debug(`[${this.guildId}] Ошибка soundcloud.getRelatedTracks: ${err.message}`);
      }

      // 3. Fallback / Supplement: If few related tracks, search SoundCloud for artist or similar artists
      if (!candidates || candidates.length < 3) {
        if (baseArtist && baseArtist !== 'SoundCloud') {
          // Try similar artists via Last.fm if available
          try {
            const similarArtists = await getSimilarArtists(baseArtist);
            const freshArtists = similarArtists.filter(
              (a) =>
                !this.recentAuthors.includes(a.toLowerCase().trim()) &&
                a.toLowerCase().trim() !== baseArtist.toLowerCase().trim(),
            );
            for (const simArtist of freshArtists.slice(0, 3)) {
              const more = await soundcloud.search(simArtist, requestedBy, 4);
              candidates.push(...more);
            }
          } catch {}

          // Also search SoundCloud for base artist's music
          try {
            const moreArtistTracks = await soundcloud.search(baseArtist, requestedBy, 6);
            candidates.push(...moreArtistTracks);
          } catch {}
        }
      }

      if (!candidates || !candidates.length) {
        logger.warn(`[${this.guildId}] Автовоспроизведение: не удалось найти подходящие треки на SoundCloud`);
        return null;
      }

      // 4. Filter candidates: only SoundCloud, unplayed, full songs
      const unplayed = candidates.filter((item) => {
        if (!item.url) return false;
        if (item.source !== 'soundcloud') return false;
        if (this.playedHistory.includes(item.url)) return false;
        if (base.url && item.url === base.url) return false;
        if (item.duration > 0 && item.duration < 50) return false; // Filter short preview snippets
        return true;
      });

      const pool = unplayed.length ? unplayed : candidates.filter((item) => item.source === 'soundcloud');
      if (!pool.length) return null;

      // 5. Score candidates for artist diversity and style retention
      const baseArtistNorm = (baseArtist || '').toLowerCase().trim();

      const scored = pool.map((cand) => {
        const candArtist = extractArtist(cand);
        const authorNorm = candArtist.toLowerCase().trim();
        let score = 0;

        if (authorNorm && authorNorm !== 'soundcloud' && authorNorm !== 'youtube') {
          const recentIndex = this.recentAuthors.indexOf(authorNorm);
          if (recentIndex === -1) {
            score += 15; // Brand new artist in the same genre
          } else {
            // Higher score if played longer ago
            score += this.recentAuthors.length - recentIndex - 1;
          }

          if (authorNorm !== baseArtistNorm) {
            score += 5; // Rotate away from current artist
          }
        }

        if (cand.duration >= 60 && cand.duration <= 450) {
          score += 3;
        }

        return { cand, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const chosen = scored[0].cand;

      chosen.isAutoplay = true;
      chosen.source = 'soundcloud';

      await this.send(
        embeds.info(`**Автовоспроизведение:** следующий трек [**${truncate(chosen.title, 70)}**](${chosen.url})`),
      );
      return chosen;
    } catch (error) {
      logger.warn(`[${this.guildId}] Ошибка автовоспроизведения: ${error.message}`);
      return null;
    }
  }

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    return this.autoplay;
  }

  scheduleIdleLeave() {
    this.clearIdleTimer();
    if (config.player.leaveOnEmptyQueueMs <= 0) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.destroyed || (this.playing && !this.paused)) return;
      this.send(embeds.info('Вышел из голосового канала из-за неактивности (5 минут без музыки).')).catch(() => {});
      this.destroy('idle').catch(() => {});
    }, config.player.leaveOnEmptyQueueMs);
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  startEmptyChannelTimer() {
    if (this.emptyChannelTimer || this.destroyed) return;
    if (config.player.leaveOnEmptyChannelMs <= 0) return;

    this.emptyChannelTimer = setTimeout(() => {
      this.emptyChannelTimer = null;
      if (this.destroyed) return;
      this.send(embeds.info('В голосовом канале никого не осталось — выхожу.')).catch(() => {});
      this.destroy('empty-channel').catch(() => {});
    }, config.player.leaveOnEmptyChannelMs);

    logger.debug(`[${this.guildId}] Канал опустел, таймер выхода запущен`);
  }

  cancelEmptyChannelTimer() {
    if (this.emptyChannelTimer) {
      clearTimeout(this.emptyChannelTimer);
      this.emptyChannelTimer = null;
      logger.debug(`[${this.guildId}] Таймер выхода отменён`);
    }
  }

  pause() {
    if (!this.current) throw new UserError('Сейчас ничего не играет.');
    if (this.paused) throw new UserError('Трек уже на паузе.');
    this.player.pause(true);
    this.scheduleIdleLeave();
    return this.current;
  }

  resume() {
    if (!this.current) throw new UserError('Сейчас ничего не играет.');
    if (!this.paused) throw new UserError('Трек и так играет.');
    this.player.unpause();
    this.clearIdleTimer();
    return this.current;
  }

  skip() {
    if (!this.current) throw new UserError('Сейчас ничего не играет.');
    this.skipVotes.clear();
    const skipped = this.current;
    if (this.loopMode === 'track') this.loopMode = 'off';
    this.manualSkip = true;
    this.idleAction = 'advance';
    this.player.stop(true);
    return skipped;
  }

  async stop() {
    if (!this.current && !this.tracks.length) throw new UserError('Нечего останавливать — очередь пуста.');

    this.tracks = [];
    this.current = null;
    this.loopMode = 'off';
    this.idleAction = 'ignore';
    this.player.stop(true);
    this.releaseStream();
    await this.retireNowPlaying();
    this.scheduleIdleLeave();
  }

  setVolume(value) {
    const volume = Math.min(100, Math.max(0, Math.round(value)));
    this.volume = volume;
    this.resource?.volume?.setVolumeLogarithmic(volume / 100);
    return volume;
  }

  setLoop(mode) {
    if (!LOOP_MODES.includes(mode)) throw new UserError('Режим повтора: **off**, **track** или **queue**.');
    this.loopMode = mode;
    return mode;
  }

  cycleLoop() {
    const index = LOOP_MODES.indexOf(this.loopMode);
    this.loopMode = LOOP_MODES[(index + 1) % LOOP_MODES.length];
    return this.loopMode;
  }

  shuffle() {
    if (this.tracks.length < 2) throw new UserError('В очереди меньше двух треков — перемешивать нечего.');

    for (let i = this.tracks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }

    return this.tracks.length;
  }

  remove(position) {
    const index = Math.floor(position) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= this.tracks.length) {
      throw new UserError(`Нет трека на позиции **${position}**. В очереди **${this.tracks.length}** шт.`);
    }
    return this.tracks.splice(index, 1)[0];
  }

  clear() {
    const count = this.tracks.length;
    this.tracks = [];
    return count;
  }

  async seek(seconds) {
    if (!this.current) throw new UserError('Сейчас ничего не играет.');
    if (!this.current.duration) throw new UserError('Это прямой эфир — перемотка недоступна.');
    if (seconds < 0) throw new UserError('Время не может быть отрицательным.');
    if (seconds >= this.current.duration) throw new UserError('Указанное время выходит за длину трека.');

    const track = this.current;
    const started = await this.tryStart(track, Math.floor(seconds));
    if (!started) {
      this.current = null;
      await this.advance();
      throw new UserError('Перемотка не удалась — трек пропущен.');
    }

    return Math.floor(seconds);
  }

  releaseStream() {
    if (this.streamHandle) {
      try {
        this.streamHandle.kill();
      } catch {}
      this.streamHandle = null;
    }
    this.resource = null;
  }

  async destroy(reason = 'manual') {
    if (this.destroyed) return;
    this.destroyed = true;

    logger.info(`[${this.guildId}] Очередь уничтожена (${reason})`);

    this.clearIdleTimer();
    this.cancelEmptyChannelTimer();
    this.tracks = [];
    this.current = null;

    this.idleAction = 'ignore';
    try {
      this.player.stop(true);
    } catch {}

    this.releaseStream();
    await this.retireNowPlaying();

    try {
      this.subscription?.unsubscribe();
    } catch {}

    try {
      const connection = this.connection ?? getVoiceConnection(this.guildId);
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    } catch (error) {
      logger.debug(`[${this.guildId}] destroy connection: ${error.message}`);
    }

    this.connection = null;
    this.manager?.delete(this.guildId);
  }
}

module.exports = { MusicQueue, LOOP_MODES };
