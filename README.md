# targetmusicbot

Дискорд-бот для воспроизведения музыки с поддержкой YouTube, Spotify и SoundCloud.

## Возможности

- Воспроизведение по ссылке или поисковому запросу (YouTube, SoundCloud, прямые HTTP-ссылки)
- Spotify: поддержка треков, альбомов и плейлистов (метаданные Spotify, аудио с YouTube)
- Очередь до 500 треков, плейлисты до 200 треков
- Режимы повтора: выключен → текущий трек → очередь
- Перемотка (`t!seek`), регулировка громкости, перемешивание
- Пагинированная очередь с кнопками
- Кнопки управления под сообщением «сейчас играет»
- Автоматический выход из канала: по таймеру пустой очереди и по пустому каналу
- Интерфейс полностью на русском языке

## Требования

- Node.js ≥ 18.17.0
- ffmpeg в PATH, через `ffmpeg-static` или в `FFMPEG_PATH`
- yt-dlp (устанавливается через `npm run setup` или `pip install -U yt-dlp`)
- Discord-бот с включёнными интентами **MESSAGE CONTENT** и **SERVER MEMBERS** (Privileged Gateway Intents)

## Установка

```bash
git clone <репозиторий>
cd targetmusicbot
npm install
npm run setup      # скачивает yt-dlp в bin/
cp .env.example .env
```

Отредактируй `.env` — как минимум нужен `DISCORD_TOKEN`.

## Настройка Discord-бота

1. Зайди на [Discord Developer Portal](https://discord.com/developers/applications) и создай приложение.
2. Вкладка **Bot** → включи **MESSAGE CONTENT INTENT** и **SERVER MEMBERS INTENT**.
3. Скопируй токен в `.env` → `DISCORD_TOKEN`.
4. Вкладка **OAuth2 → URL Generator**: отметь `bot`, в Bot Permissions — `Connect`, `Speak`, `Send Messages`, `Embed Links`, `Read Message History`. Перейди по ссылке и добавь бота на сервер.

## Настройка Spotify (опционально)

Без этого бот работает, но ссылки Spotify не будут распознаваться.

1. Зайди на [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) и создай приложение.
2. Скопируй `Client ID` и `Client Secret` в `.env`.

## Переменные окружения

| Переменная | Описание | Пример |
|---|---|---|
| `DISCORD_TOKEN` | Токен бота | `MTAx...` |
| `PREFIX` | Префикс команд | `t!` |
| `SPOTIFY_CLIENT_ID` | ID приложения Spotify | `abc123...` |
| `SPOTIFY_CLIENT_SECRET` | Секрет Spotify | `def456...` |
| `YTDLP_PATH` | Путь к yt-dlp, если не в PATH | `C:\bin\yt-dlp.exe` |
| `FFMPEG_PATH` | Путь к ffmpeg, если не в PATH | `C:\bin\ffmpeg.exe` |
| `YTDLP_COOKIES_FROM_BROWSER` | Браузер для куки (обход ограничений YouTube) | `chrome` |
| `YTDLP_COOKIES_FILE` | Файл с куки в формате Netscape | `cookies.txt` |
| `DEFAULT_VOLUME` | Начальная громкость 1–200 | `50` |
| `MAX_QUEUE_SIZE` | Максимальный размер очереди | `500` |
| `MAX_PLAYLIST_SIZE` | Максимальное число треков из плейлиста | `200` |
| `LEAVE_ON_EMPTY_QUEUE_SEC` | Секунд до выхода после опустошения очереди | `300` |
| `LEAVE_ON_EMPTY_CHANNEL_SEC` | Секунд до выхода, если канал пуст | `60` |
| `LOG_LEVEL` | Уровень логов: `debug`/`info`/`warn`/`error` | `info` |

## Запуск

```bash
npm start          # запуск
npm run dev        # запуск с перезагрузкой при изменениях (требует nodemon)
npm run doctor     # проверка зависимостей и конфигурации
```

## Команды

Все команды используют префикс `t!` (настраивается через `PREFIX` в `.env`).

### Воспроизведение

| Команда | Псевдонимы | Описание |
|---|---|---|
| `t!play <запрос или ссылка>` | `p`, `играть`, `и` | Добавить трек или плейлист в очередь |
| `t!pause` | `пауза` | Поставить на паузу |
| `t!resume` | `продолжить` | Снять с паузы |
| `t!skip [число]` | `s`, `скип` | Пропустить текущий или несколько треков |
| `t!stop` | `стоп` | Остановить воспроизведение и очистить очередь |
| `t!seek <время>` | `перемотка` | Перемотать (`1:30`, `90`, `1m30s`) |
| `t!volume [1-200]` | `vol`, `громкость` | Показать или установить громкость |

### Очередь и информация

| Команда | Псевдонимы | Описание |
|---|---|---|
| `t!queue [страница]` | `q`, `очередь` | Показать очередь |
| `t!nowplaying` | `np`, `играет` | Текущий трек с прогрессом |
| `t!shuffle` | `перемешать` | Перемешать очередь |
| `t!remove <номер>` | `rm`, `удалить` | Удалить трек из очереди |
| `t!loop` | `повтор` | Переключить режим повтора |

### Прочее

| Команда | Псевдонимы | Описание |
|---|---|---|
| `t!join` | `войти` | Войти в голосовой канал |
| `t!leave` | `выйти`, `dc` | Выйти из голосового канала |
| `t!help [команда]` | `помощь` | Список команд или справка по команде |

## Поддерживаемые форматы ссылок

- `https://youtube.com/watch?v=...` — видео
- `https://youtube.com/playlist?list=...` — плейлист
- `https://youtu.be/...` — сокращённая ссылка
- `https://soundcloud.com/artist/track` — трек
- `https://soundcloud.com/artist/sets/album` — сет/альбом
- `https://open.spotify.com/track/...` — трек
- `https://open.spotify.com/album/...` — альбом
- `https://open.spotify.com/playlist/...` — плейлист
- `spotify:track:...` и другие Spotify URI
- Прямые HTTP/HTTPS-ссылки на медиафайлы
- Любой текст → поиск на YouTube

## Решение проблем

### YouTube требует авторизацию

Некоторые видео (возрастные ограничения, некоторые регионы) требуют авторизации. Передай куки из браузера:

```env
YTDLP_COOKIES_FROM_BROWSER=chrome
```

Или экспортируй куки расширением [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) и укажи файл:

```env
YTDLP_COOKIES_FILE=cookies.txt
```

### Нет звука

Запусти `npm run doctor` — он покажет, что не найдено. Чаще всего отсутствует ffmpeg или отсутствует Opus-кодек.

```bash
# Установить ffmpeg через winget (Windows)
winget install Gyan.FFmpeg

# Установить нативный Opus
npm install @discordjs/opus
```

### Ошибка «disallowed intents»

В Discord Developer Portal → вкладка **Bot** → раздел **Privileged Gateway Intents** — включи **MESSAGE CONTENT INTENT**.

### yt-dlp не найден

```bash
npm run setup           # скачать в bin/
# или
pip install -U yt-dlp   # если установлен Python
```

## Структура проекта

```
targetmusicbot/
├── bin/                  # yt-dlp (после npm run setup)
├── scripts/
│   ├── doctor.js         # npm run doctor
│   └── install-ytdlp.js  # npm run setup
├── src/
│   ├── commands/         # команды бота
│   ├── events/           # обработчики событий Discord
│   ├── services/
│   │   ├── sources/      # youtube.js, soundcloud.js, spotify.js, generic.js
│   │   ├── ffmpeg.js
│   │   ├── resolver.js
│   │   ├── track.js
│   │   └── ytdlp.js
│   ├── structures/
│   │   ├── MusicQueue.js
│   │   └── QueueManager.js
│   ├── ui/
│   │   ├── components.js
│   │   └── embeds.js
│   ├── utils/
│   │   ├── errors.js
│   │   ├── format.js
│   │   ├── loaders.js
│   │   └── logger.js
│   └── index.js
├── .env.example
├── config.js
└── package.json
```
