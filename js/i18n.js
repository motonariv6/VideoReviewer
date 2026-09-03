import { ja } from './locales/ja.js';
import { en } from './locales/en.js';
import { zhCN } from './locales/zh-CN.js';

export const LOCALES = { ja, en, 'zh-CN': zhCN };
export const STORAGE_KEY = 'video_reviewer_locale';

export let currentLocale = 'ja';

// Original seeds to match against when resolving criteria/genres localization
const ORIGINAL_SEEDS = {
  criteria: {
    'crit-content': { name: '内容', description: 'ストーリーやテーマ性など構成要素の評価' },
    'crit-visuals': { name: '映像', description: '画質、カメラワーク、演出手法の美しさ' },
    'crit-audio': { name: '音声', description: '音響効果、BGM、声優・録音の明瞭度' },
    'crit-pacing': { name: 'テンポ', description: '展開速度、無駄な引き伸ばしのなさ' },
    'crit-originality': { name: '独自性', description: '企画力、構成、新規性、他にない特徴' },
    'crit-replayability': { name: '再視聴性', description: '何度も見たくなる魅力、見返した時の発見' }
  },
  genres: {
    'genre-default': { name: '一般', description: 'デフォルトのジャンル区分' }
  }
};

/**
 * Normalizes language tags into our supported locales: 'ja', 'en', or 'zh-CN'
 * @param {string} locale
 * @returns {string}
 */
export function normalizeLocale(locale) {
  if (typeof locale !== 'string') return 'en';
  const clean = locale.trim().toLowerCase();

  if (clean === 'ja' || clean.startsWith('ja-')) {
    return 'ja';
  }
  if (clean === 'en' || clean.startsWith('en-')) {
    return 'en';
  }
  if (clean.startsWith('zh-')) {
    if (clean === 'zh-cn' || clean === 'zh-sg' || clean.includes('hans')) {
      return 'zh-CN';
    }
    return 'en'; // zh-TW, zh-HK, zh-Hant are fallbacks to en in Phase 1
  }
  return 'en';
}

function getSupportedLocale(locale) {
  if (typeof locale !== 'string') return null;
  const clean = locale.trim().toLowerCase();

  if (clean === 'ja' || clean.startsWith('ja-')) {
    return 'ja';
  }
  if (clean === 'en' || clean.startsWith('en-')) {
    return 'en';
  }
  if (clean.startsWith('zh-')) {
    if (clean === 'zh-cn' || clean === 'zh-sg' || clean.includes('hans')) {
      return 'zh-CN';
    }
  }
  return null;
}

/**
 * Resolves local storage or navigator preference into a valid supported locale
 * @param {Object} [nav=navigator] - Optional mock navigator for testing
 * @returns {string}
 */
export function estimateLocale(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  if (typeof nav === 'string') {
    nav = { language: nav };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const norm = getSupportedLocale(saved);
      if (norm) {
        return norm;
      }
    }
  } catch (e) {
    // Ignore Storage errors in locked sandboxes
  }

  if (nav && Array.isArray(nav.languages)) {
    for (const lang of nav.languages) {
      const norm = getSupportedLocale(lang);
      if (norm) {
        return norm;
      }
    }
  }

  if (nav && nav.language) {
    const norm = getSupportedLocale(nav.language);
    if (norm) {
      return norm;
    }
  }

  return 'en';
}

function updateDocumentLang(locale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale;
  }
}

/**
 * Initializes i18n state
 * @param {Object|string} [nav=navigator]
 */
export function initI18n(nav = (typeof navigator !== 'undefined' ? navigator : {})) {
  let navObj = nav;
  if (typeof nav === 'string') {
    navObj = { language: nav };
  }
  currentLocale = estimateLocale(navObj);
  updateDocumentLang(currentLocale);
}

/**
 * Explicitly sets and saves the locale
 * @param {string} locale
 */
export function setLocale(locale) {
  const norm = normalizeLocale(locale);
  currentLocale = norm;
  try {
    localStorage.setItem(STORAGE_KEY, norm);
  } catch (e) {
    // Ignore storage lock errors
  }
  updateDocumentLang(norm);
}

/**
 * Translates a key with optional dynamic parameters
 * @param {string} key
 * @param {Object} [params={}]
 * @returns {string}
 */
export function t(key, params = {}) {
  let val = getValue(currentLocale, key);

  if (val === undefined || val === null) {
    // Current locale key not found, fallback to 'ja'
    val = getValue('ja', key);
  }

  if (val === undefined || val === null) {
    // Key not found in 'ja' either, return the key itself
    return key;
  }

  let text = String(val);
  Object.keys(params).forEach(p => {
    text = text.replace(new RegExp(`{${p}}`, 'g'), params[p]);
  });

  return text;
}

function getValue(locale, key) {
  const resources = { ja, en, 'zh-CN': zhCN };
  const obj = resources[locale];
  if (!obj) return null;

  const keys = key.split('.');
  let current = obj;
  for (const k of keys) {
    if (current === undefined || current === null) return null;
    current = current[k];
  }
  return current;
}

/**
 * Scans container elements for data-i18n and data-i18n-attr to translate in-place without destroying non-text child nodes.
 * @param {HTMLElement|Document} [container=document]
 */
export function translateDOM(container = document) {
  container.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);

    const attr = el.getAttribute('data-i18n-attr');
    if (attr) {
      attr.split(',').forEach(a => {
        const trimmed = a.trim();
        if (trimmed) el.setAttribute(trimmed, translated);
      });
    } else {
      if (el.tagName === 'TITLE') {
        el.textContent = translated;
        if (typeof document !== 'undefined') {
          document.title = translated;
        }
        return;
      }

      let hasElementChildren = false;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          hasElementChildren = true;
          break;
        }
      }

      if (!hasElementChildren) {
        el.textContent = translated;
      } else {
        // If there are child elements, find the first non-empty text node and replace its value safely
        let replaced = false;
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.nodeValue.trim() !== '') {
            child.nodeValue = translated;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          el.appendChild(document.createTextNode(translated));
        }
      }
    }
  });
}

/**
 * Translates a built-in database entity field (like 'name' or 'description')
 * only if its current database value matches the original seed value.
 * @param {string} type - 'criteria' or 'genres'
 * @param {string} id - built-in ID (e.g. 'crit-content')
 * @param {string} field - e.g. 'name' or 'description'
 * @param {string} currentValue - current value stored in DB
 * @returns {string} - translated or original value
 */
export function translateBuiltInField(type, id, field, currentValue) {
  const seeds = ORIGINAL_SEEDS[type];
  if (!seeds || !seeds[id]) return currentValue;

  const seedVal = seeds[id][field];
  if (seedVal === undefined || seedVal === null) return currentValue;

  if (currentValue === seedVal) {
    const key = `db_seeds.${type}.${id}.${field}`;
    const translated = t(key);
    return translated !== key ? translated : currentValue;
  }

  return currentValue;
}

// Automatically bootstrap on script evaluation
initI18n();
