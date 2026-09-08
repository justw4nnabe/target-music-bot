'use strict';

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'LIVE';

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
    return parts.reduce((acc, part) => acc * 60 + Number.parseInt(part, 10), 0);
  }

  const match = raw.match(/^(?:(\d+)\s*[hч])?\s*(?:(\d+)\s*[mм])?\s*(?:(\d+)\s*[sс])?$/);
  if (!match || !match.slice(1).some(Boolean)) return null;

  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

function progressBar(current, total, length = 20) {
  if (!Number.isFinite(total) || total <= 0) return '🔴 прямой эфир';

  const ratio = Math.min(1, Math.max(0, current / total));
  const position = Math.min(length - 1, Math.floor(ratio * length));
  return `${'▬'.repeat(position)}🔘${'▬'.repeat(length - position - 1)}`;
}

function truncate(text, max = 60) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\`*_~|>[\]()])/g, '\\$1');
}

function plural(count, one, few, many) {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

function tracksWord(count) {
  return plural(count, 'трек', 'трека', 'треков');
}

module.exports = {
  formatDuration,
  parseDuration,
  progressBar,
  truncate,
  escapeMarkdown,
  plural,
  tracksWord,
};
