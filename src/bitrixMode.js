import { config } from './config.js';

// Текущее состояние режима Битрикс24.
// Инициализируется из конфигурации (BITRIX_ENABLED из .env),
// на лету переключается командой /bitrix on|off из Telegram.
let bitrixEnabled = config.bitrix.enabled;

/**
 * Включён ли режим Битрикс24 прямо сейчас
 * @returns {boolean} true — режим Битрикс24, false — обычный режим
 */
export function isBitrixEnabled() {
  return bitrixEnabled;
}

/**
 * Установить режим Битрикс24
 * @param {boolean} value
 * @returns {boolean} новое состояние
 */
export function setBitrixEnabled(value) {
  bitrixEnabled = !!value;
  return bitrixEnabled;
}

/**
 * Переключить режим на противоположный
 * @returns {boolean} новое состояние
 */
export function toggleBitrix() {
  bitrixEnabled = !bitrixEnabled;
  return bitrixEnabled;
}

/**
 * Название текущего режима для сообщений пользователю
 * @returns {string} 'Битрикс24' или 'обычный'
 */
export function getModeName() {
  return bitrixEnabled ? 'Битрикс24' : 'обычный';
}