FROM node:22-bookworm-slim

# Установка системных утилит: ffmpeg, ca-certificates, curl, python3
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Установка актуального официального бинарника yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Копируем исходный код
COPY . .

ENV NODE_ENV=production

# Запуск бота
CMD ["npm", "start"]
