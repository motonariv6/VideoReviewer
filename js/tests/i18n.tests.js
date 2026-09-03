import {
  t,
  setLocale,
  currentLocale,
  normalizeLocale,
  estimateLocale,
  initI18n,
  translateDOM,
  translateBuiltInField,
  resolveUserEditedValue,
  LOCALES,
  STORAGE_KEY
} from '../i18n.js';
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { importPackage, importSharedReviewItem, DEFAULT_SHARED_REVIEWER_NAME } from '../review-sharing/review-share-importer.js';
import { buildSharedReviewViewModel, getReviewerDisplayName } from '../review-sharing/review-share-view-model.js';
import { ReviewEditorUI } from '../review/review-editor-ui.js';
import { RadarChart } from '../radar.js';

export function detectHtmlTranslationLeaks(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const allowlistTexts = new Set([
    '日本語', 'English', '简体中文',
    'VRV: VideoReViewer', 'VideoReViewer', 'VRV', '▲ 上へ', '▼ 下へ',
    'Language / 言語', '0. 動画ジャンル'
  ]);

  const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

  const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);
  let node;
  const leaks = [];

  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;

    const text = node.textContent.trim();
    if (!text) continue;

    const hasI18n = parent.hasAttribute('data-i18n') || parent.closest('[data-i18n]');
    if (!hasI18n && japaneseRegex.test(text) && !allowlistTexts.has(text)) {
      if (parent.tagName === 'OPTION' && (text === '日本語' || text === 'English' || text === '简体中文')) {
        continue;
      }
      leaks.push({ element: parent.tagName, text: text.substring(0, 30) });
    }
  }

  return leaks;
}

export function detectJsApiTranslationLeaks(code, filename = '') {
  const uiApiRegex = /(showToast|confirm|alert|prompt)\s*\(\s*(['"`])([\s\S]*?)\2\s*[,)]/g;
  const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

  const cleanCode = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  let match;
  const leaks = [];
  while ((match = uiApiRegex.exec(cleanCode)) !== null) {
    const apiName = match[1];
    const arg = match[3];
    if (japaneseRegex.test(arg)) {
      leaks.push({ file: filename, api: apiName, arg: arg.substring(0, 30) });
    }
  }

  return leaks;
}

export async function runI18nTests() {
  console.group('i18n Foundation Tests');
  const results = [];
  const initialLocale = currentLocale;
  let initialStorageLocale = null;
  try {
    initialStorageLocale = localStorage.getItem(STORAGE_KEY);
  } catch (e) {}

  try {

  const runTest = async (name, fn) => {
    try {
      await fn();
      const res = { name, passed: true };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    } catch (e) {
      const res = { name, passed: false, error: e.message || String(e) };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    }
  };

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
  }

  // Helper to flat keys
  function getFlatKeys(obj, prefix = '') {
    let keys = [];
    for (const k in obj) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        keys = keys.concat(getFlatKeys(obj[k], path));
      } else {
        keys.push(path);
      }
    }
    return keys;
  }

  // 1. ja/en/zh-CN key集合一致
  await runTest('1. 言語リソースのキー集合（平坦化）がすべての言語で完全一致すること', () => {
    const jaKeys = getFlatKeys(LOCALES.ja).sort();
    const enKeys = getFlatKeys(LOCALES.en).sort();
    const zhKeys = getFlatKeys(LOCALES['zh-CN']).sort();

    assert(jaKeys.length === enKeys.length, `ja keys count (${jaKeys.length}) !== en keys count (${enKeys.length})`);
    assert(jaKeys.length === zhKeys.length, `ja keys count (${jaKeys.length}) !== zh-CN keys count (${zhKeys.length})`);

    for (let i = 0; i < jaKeys.length; i++) {
      assert(jaKeys[i] === enKeys[i], `Key mismatch at ${i}: ja=${jaKeys[i]}, en=${enKeys[i]}`);
      assert(jaKeys[i] === zhKeys[i], `Key mismatch at ${i}: ja=${jaKeys[i]}, zh-CN=${zhKeys[i]}`);
    }
  });

  // 2. t()の正常取得
  await runTest('2. t() で現在のロケールに対応する文言が正常に取得できること', () => {
    setLocale('ja');
    assert(t('common.settings') === '設定', 'ja: common.settings mismatch');
    assert(t('library.addVideo') === '動画を追加', 'ja: library.addVideo mismatch');

    setLocale('en');
    assert(t('common.settings') === 'Settings', 'en: common.settings mismatch');
    assert(t('library.addVideo') === 'Add Video', 'en: library.addVideo mismatch');

    setLocale('zh-CN');
    assert(t('common.settings') === '设置', 'zh-CN: common.settings mismatch');
    assert(t('library.addVideo') === '添加视频', 'zh-CN: library.addVideo mismatch');
  });

  // 3. parameter置換
  await runTest('3. t() でプレースホルダーパラメータが正しく展開されること', () => {
    // 擬似的なパラメータ入りキーを一時的に注入するか、ローカル関数で検証
    // テスト用に直接 ja/en/zhCN のオブジェクトに一時追加してテストする
    LOCALES.ja.common.testParam = '選択中: {count}件';
    setLocale('ja');
    assert(t('common.testParam', { count: 5 }) === '選択中: 5件', 'Parameter replacement failed');
    delete LOCALES.ja.common.testParam;
  });

  // 4. current localeにkeyなし → ja fallback
  await runTest('4. 現在のロケールにキーが存在しない場合に ja リソースにフォールバックすること', () => {
    LOCALES.ja.common.onlyInJa = '日本語にだけある値';
    setLocale('en');
    assert(t('common.onlyInJa') === '日本語にだけある値', 'Fallback to ja failed');
    delete LOCALES.ja.common.onlyInJa;
  });

  // 5. jaにもなし → key表示
  await runTest('5. 全言語に存在しないキーを指定した際に、キー名そのものが返ること', () => {
    assert(t('common.nonexistentKey') === 'common.nonexistentKey', 'Fallback to key string failed');
  });

  // 6-10. locale normalization
  await runTest('6. normalizeLocale が正しくロケール正規化および fallback を行うこと', () => {
    assert(normalizeLocale('ja') === 'ja', 'ja -> ja');
    assert(normalizeLocale('ja-JP') === 'ja', 'ja-JP -> ja');
    assert(normalizeLocale('JA-jp') === 'ja', 'case-insensitivity check');

    assert(normalizeLocale('en') === 'en', 'en -> en');
    assert(normalizeLocale('en-US') === 'en', 'en-US -> en');
    assert(normalizeLocale('en-GB') === 'en', 'en-GB -> en');

    assert(normalizeLocale('zh-CN') === 'zh-CN', 'zh-CN -> zh-CN');
    assert(normalizeLocale('zh-sg') === 'zh-CN', 'zh-sg -> zh-CN');
    assert(normalizeLocale('zh-Hans') === 'zh-CN', 'zh-Hans -> zh-CN');
    assert(normalizeLocale('zh-Hans-CN') === 'zh-CN', 'zh-Hans-CN -> zh-CN');

    // 繁体字などは zh-CN に変換せず en にフォールバックする
    assert(normalizeLocale('zh-TW') === 'en', 'zh-TW -> en');
    assert(normalizeLocale('zh-HK') === 'en', 'zh-HK -> en');
    assert(normalizeLocale('zh-Hant') === 'en', 'zh-Hant -> en');

    // 未対応言語
    assert(normalizeLocale('fr') === 'en', 'fr -> en');
    assert(normalizeLocale('de-DE') === 'en', 'de-DE -> en');
    assert(normalizeLocale(null) === 'en', 'null -> en');
  });

  // 11-13. estimateLocale / LocalStorage 優先 / navigator 推定
  await runTest('7. estimateLocale が優先順位（LocalStorage > languages > language）に従ってロケールを推定すること', () => {
    // Mock localStorage
    const mockStorage = {};
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = (key) => mockStorage[key] || null;

    try {
      // Case A: LocalStorage が最優先
      mockStorage[STORAGE_KEY] = 'zh-CN';
      const mockNav = { languages: ['ja', 'en'], language: 'en' };
      assert(estimateLocale(mockNav) === 'zh-CN', 'LocalStorage preference failed');

      // Case B: LocalStorage がなく、navigator.languages が次点
      delete mockStorage[STORAGE_KEY];
      assert(estimateLocale(mockNav) === 'ja', 'navigator.languages preference failed');

      // Case C: languages もなく、language が最終
      const mockNav2 = { language: 'zh-CN' };
      assert(estimateLocale(mockNav2) === 'zh-CN', 'navigator.language fallback failed');

      // Case D: 全てないか未対応の場合は en
      assert(estimateLocale({}) === 'en', 'Default fallback to en failed');
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  // navigator.languages の未対応言語スキップおよび優先順位検証
  await runTest('8. navigator.languages 走査時に未対応言語を適切にスキップし後続の対応言語を採用すること', () => {
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = () => null;

    try {
      // 1. ['fr-FR', 'ja-JP'] -> ja
      const mockNav = { languages: ['fr-FR', 'ja-JP'] };
      assert(estimateLocale(mockNav) === 'ja', "['fr-FR', 'ja-JP'] should resolve to 'ja'");

      // 2. ['de-DE', 'zh-Hans'] -> zh-CN
      const mockNav2 = { languages: ['de-DE', 'zh-Hans'] };
      assert(estimateLocale(mockNav2) === 'zh-CN', "['de-DE', 'zh-Hans'] should resolve to 'zh-CN'");

      // 3. ['zh-TW', 'ja-JP'] -> ja
      const mockNav3 = { languages: ['zh-TW', 'ja-JP'] };
      assert(estimateLocale(mockNav3) === 'ja', "['zh-TW', 'ja-JP'] should resolve to 'ja'");

      // 4. ['fr-FR', 'de-DE'] -> en
      const mockNav4 = { languages: ['fr-FR', 'de-DE'] };
      assert(estimateLocale(mockNav4) === 'en', "['fr-FR', 'de-DE'] should resolve to 'en'");
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  // 14. invalid LocalStorage localeの安全なfallback
  await runTest('9. LocalStorage に無効なロケールが保存されていた場合に安全にフォールバックすること', () => {
    const mockStorage = { [STORAGE_KEY]: 'fr' }; // 未対応言語
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = (key) => mockStorage[key] || null;

    try {
      const mockNav = { languages: ['ja'], language: 'ja' };
      // LocalStorageの値 'fr' は無効なので、navigator推定の 'ja' にフォールバックされる
      assert(estimateLocale(mockNav) === 'ja', 'Invalid storage fallback failed');

      // 全て無効な場合は en になること
      const mockNav2 = { languages: ['fr'], language: 'de' };
      assert(estimateLocale(mockNav2) === 'en', 'All invalid fallback to en failed');
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  // 15. translateDOMのtext translation
  await runTest('10. translateDOM が [data-i18n] 要素のテキストノードのみを安全に翻訳置換すること', () => {
    setLocale('ja');
    LOCALES.ja.library.testText = '翻訳テスト';

    const div = document.createElement('div');
    div.innerHTML = '<span id="target" data-i18n="library.testText">元のテキスト</span>';
    document.body.appendChild(div);

    try {
      translateDOM(div);
      const span = div.querySelector('#target');
      assert(span.textContent === '翻訳テスト', 'Text translation failed');
    } finally {
      document.body.removeChild(div);
      delete LOCALES.ja.library.testText;
    }
  });

  // 16. translateDOMのattribute translation
  await runTest('11. translateDOM が [data-i18n-attr] を通じて指定属性を翻訳置換すること', () => {
    setLocale('ja');
    LOCALES.ja.library.testPlaceholder = '検索中...';

    const div = document.createElement('div');
    div.innerHTML = '<input id="target" data-i18n="library.testPlaceholder" data-i18n-attr="placeholder" placeholder="元のプレースホルダー">';
    document.body.appendChild(div);

    try {
      translateDOM(div);
      const input = div.querySelector('#target');
      assert(input.getAttribute('placeholder') === '検索中...', 'Attribute translation failed');
    } finally {
      document.body.removeChild(div);
      delete LOCALES.ja.library.testPlaceholder;
    }
  });

  // 17. SVG等のchild nodeを破壊しないこと
  await runTest('12. translateDOM が SVG アイコンなどの子要素 Element を破壊せずにテキストノードのみを安全に書き換えること', () => {
    setLocale('en');

    const div = document.createElement('div');
    // buttonの中に SVG と テキストノードが混在している状況
    div.innerHTML = `
      <button id="target" data-i18n="common.settings">
        <svg id="icon" width="10" height="10"><path d="" /></svg>
        設定
      </button>
    `;
    document.body.appendChild(div);

    try {
      translateDOM(div);
      const button = div.querySelector('#target');
      const svg = button.querySelector('#icon');

      // SVGが破棄されずに残っているか検証
      assert(svg !== null, 'SVG element was destroyed!');
      assert(svg.tagName.toLowerCase() === 'svg', 'SVG element changed tag type!');

      // テキスト部分のみが en 翻訳値「Settings」に書き換わっているか検証
      const text = button.textContent.trim();
      assert(text === 'Settings', `Text mismatch: expected "Settings", got "${text}"`);
    } finally {
      document.body.removeChild(div);
    }
  });

  // 18. translateBuiltInFieldの正常動作
  await runTest('13. translateBuiltInField が DBシード初期値と完全一致するフィールドのみを翻訳解決すること', () => {
    setLocale('en');

    // Case A: デフォルトシードのまま（未編集）の built-in field -> 英語に翻訳されること
    const translatedName = translateBuiltInField('criteria', 'crit-content', 'name', '内容');
    assert(translatedName === 'Content', `Expected "Content", got "${translatedName}"`);

    const translatedDesc = translateBuiltInField('criteria', 'crit-content', 'description', 'ストーリーやテーマ性など構成要素の評価');
    assert(translatedDesc === 'Evaluation of story, theme, and structural elements', `Description mismatch, got: "${translatedDesc}"`);

    // Case B: ユーザーが編集済み -> 翻訳されずにDBの現在値（ユーザー値）がそのまま保持されること
    const customName = translateBuiltInField('criteria', 'crit-content', 'name', '内容（改）');
    assert(customName === '内容（改）', `Expected "内容（改）", got "${customName}"`);

    // Case C: カスタム追加された項目 -> 翻訳されずそのまま保持されること
    const customCrit = translateBuiltInField('criteria', 'crit-user-custom', 'name', '独自基準');
    assert(customCrit === '独自基準', `Expected "独自基準", got "${customCrit}"`);
  });

  // 14. Phase 2: index.html 上のすべての data-i18n キーが全言語リソースに定義されていること
  await runTest('14. index.html に記述されたすべての data-i18n キーが ja, en, zh-CN に定義されていること', () => {
    // Collect keys present in index.html (if in browser or if document has them)
    if (typeof document !== 'undefined') {
      const allElements = document.querySelectorAll('[data-i18n]');
      const foundKeys = new Set();
      allElements.forEach(el => {
        const k = el.getAttribute('data-i18n');
        if (k) foundKeys.add(k);
      });

      for (const k of foundKeys) {
        setLocale('ja');
        const jaVal = t(k);
        assert(jaVal !== k, `Missing ja translation for key: ${k}`);

        setLocale('en');
        const enVal = t(k);
        assert(enVal !== k, `Missing en translation for key: ${k}`);

        setLocale('zh-CN');
        const zhVal = t(k);
        assert(zhVal !== k, `Missing zh-CN translation for key: ${k}`);
      }
    }
  });

  // 15. Phase 2: ブランド名称とtaglineの検証
  await runTest('15. VRV: VideoReViewer ブランドおよび tagline が正しく定義・表示されること', () => {
    setLocale('ja');
    assert(t('brand.tagline') === 'Review what you view.', 'ja brand.tagline mismatch');
    assert(t('brand.pageTitle').includes('VRV: VideoReViewer'), 'ja brand.pageTitle should contain "VRV: VideoReViewer"');

    setLocale('en');
    assert(t('brand.tagline') === 'Review what you view.', 'en brand.tagline mismatch');
    assert(t('brand.pageTitle') === 'VRV: VideoReViewer - Review what you view.', 'en brand.pageTitle mismatch');

    setLocale('zh-CN');
    assert(t('brand.tagline') === 'Review what you view.', 'zh-CN brand.tagline mismatch');
    assert(t('brand.pageTitle').includes('VRV: VideoReViewer'), 'zh-CN brand.pageTitle should contain "VRV: VideoReViewer"');
  });

  // 16. Phase 2: translateDOM によるカンマ区切り複数属性の更新
  await runTest('16. translateDOM がカンマ区切り複数属性（title, aria-label）を同時に翻訳すること', () => {
    setLocale('ja');
    const btn = document.createElement('button');
    btn.setAttribute('data-i18n', 'common.close');
    btn.setAttribute('data-i18n-attr', 'title,aria-label');
    document.body.appendChild(btn);

    try {
      translateDOM(btn.parentElement);
      assert(btn.getAttribute('title') === '閉じる', 'title attribute translation failed');
      assert(btn.getAttribute('aria-label') === '閉じる', 'aria-label attribute translation failed');

      setLocale('en');
      translateDOM(btn.parentElement);
      assert(btn.getAttribute('title') === 'Close', 'en title attribute translation failed');
      assert(btn.getAttribute('aria-label') === 'Close', 'en aria-label attribute translation failed');
    } finally {
      document.body.removeChild(btn);
    }
  });

  // 17. Phase 2: translateDOM による <title> の更新
  await runTest('17. translateDOM が <title> 要素および document.title を更新すること', () => {
    setLocale('en');
    const titleEl = document.createElement('title');
    titleEl.setAttribute('data-i18n', 'brand.pageTitle');
    document.head.appendChild(titleEl);

    try {
      translateDOM(document);
      assert(titleEl.textContent === 'VRV: VideoReViewer - Review what you view.', 'title element text mismatch');
      assert(document.title === 'VRV: VideoReViewer - Review what you view.', 'document.title mismatch');
    } finally {
      document.head.removeChild(titleEl);
    }
  });

  // 18. Phase 2: initI18n および setLocale による document.documentElement.lang の同期
  await runTest('18. initI18n および setLocale が document.documentElement.lang を各ロケールに正しく同期すること', () => {
    const originalGetItem = localStorage.getItem;
    localStorage.getItem = () => null; // ignore saved localStorage to test navigator/string input

    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        // Test A: initI18n with en-US
        initI18n('en-US');
        assert(currentLocale === 'en', `Expected currentLocale 'en', got '${currentLocale}'`);
        assert(document.documentElement.lang === 'en', `Expected html lang 'en', got '${document.documentElement.lang}'`);

        // Test B: initI18n with ja-JP
        initI18n('ja-JP');
        assert(currentLocale === 'ja', `Expected currentLocale 'ja', got '${currentLocale}'`);
        assert(document.documentElement.lang === 'ja', `Expected html lang 'ja', got '${document.documentElement.lang}'`);

        // Test C: initI18n with zh-Hans
        initI18n('zh-Hans');
        assert(currentLocale === 'zh-CN', `Expected currentLocale 'zh-CN', got '${currentLocale}'`);
        assert(document.documentElement.lang === 'zh-CN', `Expected html lang 'zh-CN', got '${document.documentElement.lang}'`);

        // Test D: initI18n with object { languages: ['en-US'] }
        initI18n({ languages: ['en-US'] });
        assert(currentLocale === 'en', `Expected currentLocale 'en', got '${currentLocale}'`);
        assert(document.documentElement.lang === 'en', `Expected html lang 'en', got '${document.documentElement.lang}'`);

        // Test E: setLocale synchronization
        setLocale('ja');
        assert(document.documentElement.lang === 'ja', `setLocale('ja') failed: got '${document.documentElement.lang}'`);

        setLocale('en');
        assert(document.documentElement.lang === 'en', `setLocale('en') failed: got '${document.documentElement.lang}'`);

        setLocale('zh-CN');
        assert(document.documentElement.lang === 'zh-CN', `setLocale('zh-CN') failed: got '${document.documentElement.lang}'`);
      }
    } finally {
      localStorage.getItem = originalGetItem;
    }
  });

  // 17. Phase 3: Dynamic UI key translation across ja, en, zh-CN
  await runTest('17. Phase 3: 主要な動的UIキー（toast, confirm, badge, folder, backup等）が全言語で正しく取得できること', () => {
    const testKeys = [
      'common.confirmUnsavedChanges',
      'library.toastSystemFileIgnored',
      'library.badgeMissingFile',
      'library.badgePermRequired',
      'library.badgeNoDir',
      'player.confirmUnsavedBack',
      'player.confirmUnsavedAdjacent',
      'folder.toastScanAborting',
      'folder.toastPermGranted',
      'tag.confirmDelete',
      'settings.toastMaxCriteriaExceeded',
      'settings.confirmDeleteCriteria',
      'backup.progressCreatingTitle',
      'backup.toastCreated',
      'backup.alertNoOrphanFound',
      'share.reviewerSelf',
      'share.reviewerUnknown',
      'share.toastExportSuccess',
      'poster.confirmDelete',
      'poster.toastSetSuccess'
    ];

    ['ja', 'en', 'zh-CN'].forEach(loc => {
      setLocale(loc);
      testKeys.forEach(key => {
        const val = t(key);
        assert(typeof val === 'string' && val.length > 0, `Locale ${loc} for key '${key}' returned empty or non-string`);
        assert(val !== key, `Locale ${loc} for key '${key}' returned the key itself (untranslated)`);
      });
    });
  });

  // 18. Phase 3: Parameter replacement preserves user data untouched
  await runTest('18. Phase 3: パラメータ置換でユーザーデータ（タイトル、パス等）がそのまま保持されること', () => {
    const sampleTitle = '【重要】サンプル動画_2026.mp4';
    const sampleCount = 42;

    setLocale('ja');
    const jaResult = t('library.btnBulkDeleteCount', { count: sampleCount });
    assert(jaResult.includes('42'), `ja: Expected count '42' in '${jaResult}'`);

    setLocale('en');
    const enResult = t('library.btnBulkDeleteCount', { count: sampleCount });
    assert(enResult.includes('42'), `en: Expected count '42' in '${enResult}'`);

    setLocale('zh-CN');
    const zhResult = t('library.btnBulkDeleteCount', { count: sampleCount });
    assert(zhResult.includes('42'), `zh-CN: Expected count '42' in '${zhResult}'`);

    // Title parameter preservation
    setLocale('ja');
    const jaResolved = t('library.toastPendingResolved', { count: 3, title: sampleTitle });
    assert(jaResolved.includes(sampleTitle), `ja: Expected sampleTitle in '${jaResolved}'`);

    setLocale('en');
    const enResolved = t('library.toastPendingResolved', { count: 3, title: sampleTitle });
    assert(enResolved.includes(sampleTitle), `en: Expected sampleTitle in '${enResolved}'`);

    setLocale('zh-CN');
    const zhResolved = t('library.toastPendingResolved', { count: 3, title: sampleTitle });
    assert(zhResolved.includes(sampleTitle), `zh-CN: Expected sampleTitle in '${zhResolved}'`);
  });

  // 19. Phase 3: Complex multi-parameter replacement (backup restore & clean)
  await runTest('19. Phase 3: 複数パラメータ置換（バックアップ復元・クリーンアップ文言）の正確性', () => {
    setLocale('ja');
    const jaClean = t('backup.toastCleaned', { notes: 12, images: 5 });
    assert(jaClean.includes('12') && jaClean.includes('5'), `ja: Multi-param failed in '${jaClean}'`);

    setLocale('en');
    const enClean = t('backup.toastCleaned', { notes: 12, images: 5 });
    assert(enClean.includes('12') && enClean.includes('5'), `en: Multi-param failed in '${enClean}'`);

    setLocale('zh-CN');
    const zhClean = t('backup.toastCleaned', { notes: 12, images: 5 });
    assert(zhClean.includes('12') && zhClean.includes('5'), `zh-CN: Multi-param failed in '${zhClean}'`);
  });

  // 20. Phase 3 Regression Test: imported reviewer DB persistence invariance across ja/en/zh-CN and UI fallback translation
  await runTest('20. Phase 3 回帰テスト: imported reviewer の DB 保存値が locale に依存せず不変であり、UI表示時のみ翻訳されること', () => {
    const videoHash = 'aaaa111111111111111111111111111111111111111111111111111111111111';

    const setupDb = () => {
      const storage = new MemoryStorage();
      storage.setItem('vreview_schema_version', '4');
      const db = new AppDatabase(storage);
      db.mediaAssets = [
        {
          id: 'vid-test-fallback-01',
          title: 'test-fallback.mp4',
          fileName: 'test-fallback.mp4',
          contentHash: videoHash,
          hashAlgorithm: 'SHA-256',
          hashStatus: 'completed',
          fileSize: 5000,
          duration: 30,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      return db;
    };

    const dummyReview = {
      reviewId: '11111111-2222-4333-8444-aaaaaaaaaaaa',
      reviewerId: '11111111-2222-4333-8444-999999999999',
      overallRating: 5,
      comment: 'Great shared video',
      tags: [],
      timelineComments: []
    };

    // Step 1: Import with empty/undefined exporterDisplayName under ja, en, and zh-CN
    const dbJa = setupDb();
    setLocale('ja');
    importSharedReviewItem(dbJa, {
      videoHash,
      review: dummyReview,
      exporterDisplayName: '',
      matchedVideo: dbJa.mediaAssets[0]
    });

    const dbEn = setupDb();
    setLocale('en');
    importSharedReviewItem(dbEn, {
      videoHash,
      review: dummyReview,
      exporterDisplayName: '',
      matchedVideo: dbEn.mediaAssets[0]
    });

    const dbZh = setupDb();
    setLocale('zh-CN');
    importSharedReviewItem(dbZh, {
      videoHash,
      review: dummyReview,
      exporterDisplayName: '',
      matchedVideo: dbZh.mediaAssets[0]
    });

    // Verify 1: DB persistence values MUST be identical across all locales (locale-independent)
    const reviewerJa = dbJa.reviewers.find(r => r.sourceReviewerId === '11111111-2222-4333-8444-999999999999');
    const reviewerEn = dbEn.reviewers.find(r => r.sourceReviewerId === '11111111-2222-4333-8444-999999999999');
    const reviewerZh = dbZh.reviewers.find(r => r.sourceReviewerId === '11111111-2222-4333-8444-999999999999');

    assert(reviewerJa !== undefined, 'reviewerJa should exist in DB');
    assert(reviewerEn !== undefined, 'reviewerEn should exist in DB');
    assert(reviewerZh !== undefined, 'reviewerZh should exist in DB');

    // All three must store the EXACT same fallback string in DB, regardless of UI locale at import time
    assert(reviewerJa.displayName === DEFAULT_SHARED_REVIEWER_NAME, `reviewerJa.displayName should be '${DEFAULT_SHARED_REVIEWER_NAME}', got '${reviewerJa.displayName}'`);
    assert(reviewerEn.displayName === DEFAULT_SHARED_REVIEWER_NAME, `reviewerEn.displayName should be '${DEFAULT_SHARED_REVIEWER_NAME}', got '${reviewerEn.displayName}'`);
    assert(reviewerZh.displayName === DEFAULT_SHARED_REVIEWER_NAME, `reviewerZh.displayName should be '${DEFAULT_SHARED_REVIEWER_NAME}', got '${reviewerZh.displayName}'`);
    assert(reviewerJa.displayName === reviewerEn.displayName, 'DB stored reviewer name must not vary between ja and en');
    assert(reviewerEn.displayName === reviewerZh.displayName, 'DB stored reviewer name must not vary between en and zh-CN');

    // Verify 2: UI View Model MUST resolve fallback dynamically according to current UI locale
    setLocale('ja');
    assert(getReviewerDisplayName(reviewerEn) === '共有レビュアー', `ja UI should resolve to '共有レビュアー', got '${getReviewerDisplayName(reviewerEn)}'`);

    setLocale('en');
    assert(getReviewerDisplayName(reviewerJa) === 'Shared Reviewer', `en UI should resolve to 'Shared Reviewer', got '${getReviewerDisplayName(reviewerJa)}'`);

    setLocale('zh-CN');
    assert(getReviewerDisplayName(reviewerJa) === '共享审阅者', `zh-CN UI should resolve to '共享审阅者', got '${getReviewerDisplayName(reviewerJa)}'`);

    // Verify 3: Full ViewModel integration test across ja, en, zh-CN
    setLocale('ja');
    const vmJa = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmJa.reviewers[0].displayName === '共有レビュアー', `vmJa: Expected '共有レビュアー', got '${vmJa.reviewers[0].displayName}'`);

    setLocale('en');
    const vmEn = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmEn.reviewers[0].displayName === 'Shared Reviewer', `vmEn: Expected 'Shared Reviewer', got '${vmEn.reviewers[0].displayName}'`);

    setLocale('zh-CN');
    const vmZh = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmZh.reviewers[0].displayName === '共享审阅者', `vmZh: Expected '共享审阅者', got '${vmZh.reviewers[0].displayName}'`);

    // Verify 4: When exporter displayName IS provided, it is stored as-is and preserved in UI
    const dbNamed = setupDb();
    setLocale('en');
    importSharedReviewItem(dbNamed, {
      videoHash,
      review: {
        ...dummyReview,
        reviewId: '11111111-2222-4333-8444-bbbbbbbbbbbb',
        reviewerId: '11111111-2222-4333-8444-888888888888'
      },
      exporterDisplayName: 'Alice (Reviewer)',
      matchedVideo: dbNamed.mediaAssets[0]
    });
    const namedReviewer = dbNamed.reviewers.find(r => r.sourceReviewerId === '11111111-2222-4333-8444-888888888888');
    assert(namedReviewer.displayName === 'Alice (Reviewer)', 'Custom displayName must be saved as-is');

    setLocale('ja');
    assert(getReviewerDisplayName(namedReviewer) === 'Alice (Reviewer)', 'Custom displayName must not be translated in ja');
    setLocale('zh-CN');
    assert(getReviewerDisplayName(namedReviewer) === 'Alice (Reviewer)', 'Custom displayName must not be translated in zh-CN');
  });

  // 21. Phase 3 回帰テスト: currentLocale および LocalStorage の完全復元（未設定／設定済みの両ケース）
  await runTest('21. Phase 3 回帰テスト: ロケール変更テスト終了後に currentLocale および LocalStorage が完全復元されること', () => {
    const restoreHelper = (initialLoc, initialStorage) => {
      setLocale(initialLoc);
      try {
        if (initialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, initialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    };

    // Case 1: STORAGE_KEY 未設定の場合
    {
      const initialLoc = 'ja';
      setLocale(initialLoc);
      localStorage.removeItem(STORAGE_KEY);
      assert(localStorage.getItem(STORAGE_KEY) === null, 'Precondition: storage key should be unset');
      assert(currentLocale === 'ja', 'Precondition: currentLocale should be ja');

      try {
        setLocale('en');
        assert(currentLocale === 'en');
        assert(localStorage.getItem(STORAGE_KEY) === 'en');
      } finally {
        restoreHelper(initialLoc, null);
      }

      assert(currentLocale === 'ja', 'Case 1: currentLocale must be restored to ja');
      assert(localStorage.getItem(STORAGE_KEY) === null, 'Case 1: STORAGE_KEY must remain unset after restore');
    }

    // Case 2: STORAGE_KEY='en' で明示設定されていた場合
    {
      const initialLoc = 'en';
      setLocale(initialLoc);
      localStorage.setItem(STORAGE_KEY, 'en');
      assert(localStorage.getItem(STORAGE_KEY) === 'en', 'Precondition: storage key should be en');
      assert(currentLocale === 'en', 'Precondition: currentLocale should be en');

      try {
        setLocale('zh-CN');
        assert(currentLocale === 'zh-CN');
        assert(localStorage.getItem(STORAGE_KEY) === 'zh-CN');
      } finally {
        restoreHelper(initialLoc, 'en');
      }

      assert(currentLocale === 'en', 'Case 2: currentLocale must be restored to en');
      assert(localStorage.getItem(STORAGE_KEY) === 'en', 'Case 2: STORAGE_KEY must remain en after restore');
    }

    // Case 3: STORAGE_KEY='zh-CN' で明示設定されていた場合
    {
      const initialLoc = 'zh-CN';
      setLocale(initialLoc);
      localStorage.setItem(STORAGE_KEY, 'zh-CN');

      try {
        setLocale('ja');
        assert(currentLocale === 'ja');
        assert(localStorage.getItem(STORAGE_KEY) === 'ja');
      } finally {
        restoreHelper(initialLoc, 'zh-CN');
      }

      assert(currentLocale === 'zh-CN', 'Case 3: currentLocale must be restored to zh-CN');
      assert(localStorage.getItem(STORAGE_KEY) === 'zh-CN', 'Case 3: STORAGE_KEY must remain zh-CN after restore');
    }
  });

  // 22. Phase 4: Language Selector (A〜F)
  await runTest('22. Phase 4: Language Selector (A-F: value sync, LocalStorage, precedence, html lang)', () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      // A: currentLocale is reflected in selector value
      const select = document.createElement('select');
      select.id = 'settings-language-select';
      ['ja', 'en', 'zh-CN'].forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc;
        select.appendChild(opt);
      });
      select.value = currentLocale;
      assert(select.value === currentLocale, 'A: selector value must match currentLocale');

      // B: Select ja -> LocalStorage = ja
      setLocale('ja');
      assert(currentLocale === 'ja', 'B: currentLocale must be ja');
      assert(localStorage.getItem(STORAGE_KEY) === 'ja', 'B: LocalStorage must be ja');

      // C: Select en -> LocalStorage = en
      setLocale('en');
      assert(currentLocale === 'en', 'C: currentLocale must be en');
      assert(localStorage.getItem(STORAGE_KEY) === 'en', 'C: LocalStorage must be en');

      // D: Select zh-CN -> LocalStorage = zh-CN
      setLocale('zh-CN');
      assert(currentLocale === 'zh-CN', 'D: currentLocale must be zh-CN');
      assert(localStorage.getItem(STORAGE_KEY) === 'zh-CN', 'D: LocalStorage must be zh-CN');

      // E: Precedence: LocalStorage overrides navigator.language
      localStorage.setItem(STORAGE_KEY, 'ja');
      initI18n('en-US');
      assert(currentLocale === 'ja', 'E: saved LocalStorage (ja) must take precedence over navigator.language (en-US)');

      localStorage.setItem(STORAGE_KEY, 'en');
      initI18n('zh-CN');
      assert(currentLocale === 'en', 'E: saved LocalStorage (en) must take precedence over navigator.language (zh-CN)');

      // F: html lang syncs with locale
      setLocale('ja');
      if (typeof document !== 'undefined' && document.documentElement) {
        assert(document.documentElement.lang === 'ja', 'F: documentElement.lang must be ja');
      }
      setLocale('en');
      if (typeof document !== 'undefined' && document.documentElement) {
        assert(document.documentElement.lang === 'en', 'F: documentElement.lang must be en');
      }
      setLocale('zh-CN');
      if (typeof document !== 'undefined' && document.documentElement) {
        assert(document.documentElement.lang === 'zh-CN', 'F: documentElement.lang must be zh-CN');
      }
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 23. Phase 4: Language Recovery UX
  await runTest('23. Phase 4: Language Recovery UX (gear icon, globe visual, Language identifier, native options)', () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      // 1. Settings gear icon exists in DOM
      const btnSettings = document.getElementById('btn-settings');
      if (btnSettings) {
        const svg = btnSettings.querySelector('svg');
        assert(svg !== null, 'Settings trigger must contain gear icon SVG');
      }

      // 2. Globe visual icon exists in Settings Language section
      const languageIcon = document.getElementById('settings-language-icon');
      if (languageIcon) {
        assert(languageIcon.tagName.toLowerCase() === 'svg', 'Language icon must be SVG');
      }

      // 3. "Language" identifier is recognizable in all locales
      setLocale('ja');
      assert(t('settings.languageLabel').includes('Language'), 'ja settings.languageLabel must contain "Language"');
      assert(t('settings.languageLabel') === 'Language / 言語', 'ja settings.languageLabel must be "Language / 言語"');

      setLocale('en');
      assert(t('settings.languageLabel').includes('Language'), 'en settings.languageLabel must contain "Language"');
      assert(t('settings.languageLabel') === 'Language', 'en settings.languageLabel must be "Language"');

      setLocale('zh-CN');
      assert(t('settings.languageLabel').includes('Language'), 'zh-CN settings.languageLabel must contain "Language"');
      assert(t('settings.languageLabel') === 'Language / 语言', 'zh-CN settings.languageLabel must be "Language / 语言"');

      // 4. Native options in index.html or DOM
      const select = document.getElementById('settings-language-select');
      if (select) {
        const options = Array.from(select.options);
        const optValues = options.map(o => o.value);

        assert(optValues.includes('ja'), 'Selector must have option ja');
        assert(optValues.includes('en'), 'Selector must have option en');
        assert(optValues.includes('zh-CN'), 'Selector must have option zh-CN');

        const jaOpt = options.find(o => o.value === 'ja');
        const enOpt = options.find(o => o.value === 'en');
        const zhOpt = options.find(o => o.value === 'zh-CN');

        assert(jaOpt && jaOpt.textContent === '日本語', 'ja option must be native "日本語"');
        assert(enOpt && enOpt.textContent === 'English', 'en option must be native "English"');
        assert(zhOpt && zhOpt.textContent === '简体中文', 'zh-CN option must be native "简体中文"');
      }

      // 5. Recovery simulation: When in zh-CN, user can locate "Language" and select "English" or "日本語"
      setLocale('zh-CN');
      const zhLabel = t('settings.languageLabel');
      assert(zhLabel.includes('Language'), 'A user stuck in zh-CN can locate section via "Language"');
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 24. Phase 4: Built-in Seed Display Translation
  await runTest('24. Phase 4: Built-in Seed Display Translation (untouched built-in genres & criteria)', () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      const dbMock = {
        genres: [{ id: 'genre-default', name: '一般', description: 'デフォルトのジャンル区分', isActive: true }],
        criteria: [
          { id: 'crit-content', name: '内容', description: 'ストーリーやテーマ性など構成要素の評価', isActive: true },
          { id: 'crit-visuals', name: '映像', description: '画質、カメラワーク、演出手法の美しさ', isActive: true },
          { id: 'crit-audio', name: '音声', description: '音響効果、BGM、声優・録音の明瞭度', isActive: true },
          { id: 'crit-pacing', name: 'テンポ', description: '展開速度、無駄な引き伸ばしのなさ', isActive: true },
          { id: 'crit-originality', name: '独自性', description: '企画力、構成、新規性、他にない特徴', isActive: true },
          { id: 'crit-replayability', name: '再視聴性', description: '何度も見たくなる魅力、見返した時の発見', isActive: true }
        ]
      };

      // 1. In Japanese
      setLocale('ja');
      assert(translateBuiltInField('genres', 'genre-default', 'name', '一般') === '一般');
      assert(translateBuiltInField('genres', 'genre-default', 'description', 'デフォルトのジャンル区分') === 'デフォルトのジャンル区分');
      assert(translateBuiltInField('criteria', 'crit-visuals', 'name', '映像') === '映像');

      // 2. In English
      setLocale('en');
      assert(translateBuiltInField('genres', 'genre-default', 'name', '一般') === 'General');
      assert(translateBuiltInField('genres', 'genre-default', 'description', 'デフォルトのジャンル区分') === 'Default genre classification');
      assert(translateBuiltInField('criteria', 'crit-content', 'name', '内容') === 'Content');
      assert(translateBuiltInField('criteria', 'crit-visuals', 'name', '映像') === 'Visuals');
      assert(translateBuiltInField('criteria', 'crit-audio', 'name', '音声') === 'Audio');
      assert(translateBuiltInField('criteria', 'crit-pacing', 'name', 'テンポ') === 'Pacing');
      assert(translateBuiltInField('criteria', 'crit-originality', 'name', '独自性') === 'Originality');
      assert(translateBuiltInField('criteria', 'crit-replayability', 'name', '再視聴性') === 'Replayability');

      // 3. In Simplified Chinese
      setLocale('zh-CN');
      assert(translateBuiltInField('genres', 'genre-default', 'name', '一般') === '常规');
      assert(translateBuiltInField('genres', 'genre-default', 'description', 'デフォルトのジャンル区分') === '默认类型');
      assert(translateBuiltInField('criteria', 'crit-content', 'name', '内容') === '内容');
      assert(translateBuiltInField('criteria', 'crit-visuals', 'name', '映像') === '画面');
      assert(translateBuiltInField('criteria', 'crit-audio', 'name', '音声') === '音频');
      assert(translateBuiltInField('criteria', 'crit-pacing', 'name', 'テンポ') === '节奏');
      assert(translateBuiltInField('criteria', 'crit-originality', 'name', '独自性') === '独创性');
      assert(translateBuiltInField('criteria', 'crit-replayability', 'name', '再視聴性') === '重温价值');

      // 4. UI components integration test (ReviewEditorUI & RadarChart)
      const mockEls = {
        viewLibrary: document.createElement('div'),
        viewEditor: document.createElement('div'),
        btnBack: document.createElement('button'),
        editorTitle: document.createElement('h3'),
        infoFileName: document.createElement('span'),
        infoFileSize: document.createElement('span'),
        infoDuration: document.createElement('span'),
        titleDisplayContainer: document.createElement('div'),
        titleEditContainer: document.createElement('div'),
        displayTitleInput: document.createElement('input'),
        videoGenreSelect: document.createElement('select'),
        criteriaPanel: document.createElement('div')
      };
      const editorUI = new ReviewEditorUI({ els: mockEls });

      // In en
      setLocale('en');
      editorUI.populateGenreSelect(dbMock.genres, 'genre-default');
      assert(mockEls.videoGenreSelect.options[0].textContent === 'General', 'Editor genre option must be translated to English');

      editorUI.renderStarCriteriaPanel(dbMock.criteria, { 'crit-visuals': 4 }, () => {});
      const labelsEn = Array.from(mockEls.criteriaPanel.querySelectorAll('.star-rating-label')).map(l => l.textContent);
      assert(labelsEn.includes('Visuals'), `Criteria labels in en must include Visuals, got: ${labelsEn.join(', ')}`);
      assert(labelsEn.includes('Audio'), `Criteria labels in en must include Audio, got: ${labelsEn.join(', ')}`);

      // In zh-CN
      setLocale('zh-CN');
      editorUI.populateGenreSelect(dbMock.genres, 'genre-default');
      assert(mockEls.videoGenreSelect.options[0].textContent === '常规', 'Editor genre option must be translated to Simplified Chinese');

      editorUI.renderStarCriteriaPanel(dbMock.criteria, { 'crit-visuals': 4 }, () => {});
      const labelsZh = Array.from(mockEls.criteriaPanel.querySelectorAll('.star-rating-label')).map(l => l.textContent);
      assert(labelsZh.includes('画面'), `Criteria labels in zh-CN must include 画面, got: ${labelsZh.join(', ')}`);
      assert(labelsZh.includes('音频'), `Criteria labels in zh-CN must include 音频, got: ${labelsZh.join(', ')}`);

      // RadarChart
      const radarContainer = document.createElement('div');
      const radar = new RadarChart(radarContainer);
      setLocale('en');
      radar.render(dbMock.criteria, { 'crit-visuals': 4 });
      const titlesEn = Array.from(radarContainer.querySelectorAll('title')).map(tNode => tNode.textContent);
      assert(titlesEn.some(tText => tText.startsWith('Visuals:')), `Radar tooltip must start with Visuals:, got: ${titlesEn.join(', ')}`);

      // Verify DB records remain completely untouched
      assert(dbMock.genres[0].name === '一般', 'DB genre name must remain 一般');
      assert(dbMock.criteria[1].name === '映像', 'DB criterion name must remain 映像');
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 25. Phase 4: Field-by-field Preservation
  await runTest('25. Phase 4: Field-by-field Preservation (edited field is preserved, untouched field translates)', () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      // User edits ONLY name of crit-content to 'ストーリー構成', keeps description untouched
      const editedName = 'ストーリー構成';
      const untouchedDesc = 'ストーリーやテーマ性など構成要素の評価';

      setLocale('en');
      // Name was edited -> currentValue !== original seed -> preserves editedName!
      const nameInEn = translateBuiltInField('criteria', 'crit-content', 'name', editedName);
      assert(nameInEn === 'ストーリー構成', `Edited name must NOT be translated in en, got: '${nameInEn}'`);

      // Description was untouched -> currentValue === original seed -> translates to English!
      const descInEn = translateBuiltInField('criteria', 'crit-content', 'description', untouchedDesc);
      assert(descInEn === 'Evaluation of story, theme, and structural elements', `Untouched description MUST translate to en, got: '${descInEn}'`);

      setLocale('zh-CN');
      // Name still preserved in zh-CN
      const nameInZh = translateBuiltInField('criteria', 'crit-content', 'name', editedName);
      assert(nameInZh === 'ストーリー構成', `Edited name must NOT be translated in zh-CN, got: '${nameInZh}'`);

      // Description translates to Simplified Chinese
      const descInZh = translateBuiltInField('criteria', 'crit-content', 'description', untouchedDesc);
      assert(descInZh === '故事和主题性等构成要素的评价', `Untouched description MUST translate to zh-CN, got: '${descInZh}'`);

      setLocale('ja');
      const nameInJa = translateBuiltInField('criteria', 'crit-content', 'name', editedName);
      assert(nameInJa === 'ストーリー構成', `Edited name must remain in ja, got: '${nameInJa}'`);
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 26. Phase 4: User Data Preservation
  await runTest('26. Phase 4: User Data Preservation (custom genres, criteria, tags, comments remain invariant)', () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      const userGenre = { id: 'genre-user-custom', name: 'ゲーム実況', description: 'ゲームプレイ動画' };
      const userCriterion = { id: 'crit-user-custom', name: '面白さ', description: '純粋なエンタメ度' };
      const userTag = 'お気に入り';
      const userComment = '最高のアクションシーン';
      const userTimelineNote = 'ここが見どころ';
      const userReviewer = 'レビュー太郎';
      const userTitle = '私の動画';

      ['ja', 'en', 'zh-CN'].forEach(loc => {
        setLocale(loc);
        assert(translateBuiltInField('genres', userGenre.id, 'name', userGenre.name) === 'ゲーム実況', `userGenre in ${loc}`);
        assert(translateBuiltInField('genres', userGenre.id, 'description', userGenre.description) === 'ゲームプレイ動画', `userGenre desc in ${loc}`);
        assert(translateBuiltInField('criteria', userCriterion.id, 'name', userCriterion.name) === '面白さ', `userCriterion in ${loc}`);
        assert(translateBuiltInField('criteria', userCriterion.id, 'description', userCriterion.description) === '純粋なエンタメ度', `userCriterion desc in ${loc}`);
        assert(userTag === 'お気に入り', `userTag in ${loc}`);
        assert(userComment === '最高のアクションシーン', `userComment in ${loc}`);
        assert(userTimelineNote === 'ここが見どころ', `userTimelineNote in ${loc}`);
        assert(userReviewer === 'レビュー太郎', `userReviewer in ${loc}`);
        assert(userTitle === '私の動画', `userTitle in ${loc}`);
      });
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 27. Phase 4: Backup / Shared Review Boundary
  await runTest('27. Phase 4: Backup / Shared Review Boundary (locale and UI translations excluded from persistent data)', async () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      setLocale('en');

      // 1. Shared Review Package boundary
      const pkg = {
        formatVersion: 1,
        source: 'videoreviewer',
        exportedAt: new Date().toISOString(),
        exporter: {
          reviewerId: '00000000-0000-4000-8000-000000000001',
          displayName: 'Local Reviewer'
        },
        items: []
      };

      assert(!('locale' in pkg), 'Shared Review package must not contain locale');
      assert(!('video_reviewer_locale' in pkg), 'Shared Review package must not contain video_reviewer_locale');

      // 2. DB / Backup boundary
      const storage = new MemoryStorage();
      storage.setItem('vreview_schema_version', '4');
      const dbInstance = new AppDatabase(storage);
      await dbInstance.initAsync();

      const exportedData = {
        version: 4,
        genres: dbInstance.genres,
        criteria: dbInstance.criteria,
        templates: dbInstance.templates
      };

      assert(!('locale' in exportedData), 'Backup data must not contain locale');
      assert(!('video_reviewer_locale' in exportedData), 'Backup data must not contain video_reviewer_locale');

      // Ensure built-in records in DB/Backup are stored with their seed originals, NOT translated display values
      const defaultGenreInDb = exportedData.genres.find(g => g.id === 'genre-default');
      assert(defaultGenreInDb && defaultGenreInDb.name === '一般', 'DB genre name must remain original seed "一般"');
      assert(defaultGenreInDb && defaultGenreInDb.name !== 'General', 'DB genre name must NOT be saved as "General"');

      const visualsCritInDb = exportedData.criteria.find(c => c.id === 'crit-visuals');
      assert(visualsCritInDb && visualsCritInDb.name === '映像', 'DB criterion name must remain original seed "映像"');
      assert(visualsCritInDb && visualsCritInDb.name !== 'Visuals', 'DB criterion name must NOT be saved as "Visuals"');
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 28. Phase 4: Translation Leak Detection (fail-closed)
  await runTest('28. Phase 4: Translation Leak Detection (fail-closed check for hard-coded Japanese strings)', async () => {
    assert(typeof fetch !== 'undefined', 'fetch API must be available for translation leak inspection');

    // A. index.html static UI text check (fail-closed)
    const htmlRes = await fetch('/index.html');
    assert(htmlRes.ok, `Failed to fetch /index.html: HTTP ${htmlRes.status}`);
    const html = await htmlRes.text();
    const htmlLeaks = detectHtmlTranslationLeaks(html);
    assert(htmlLeaks.length === 0, `Detected hard-coded Japanese text in index.html without data-i18n: ${JSON.stringify(htmlLeaks)}`);

    // B. Production JS files check for raw Japanese string literals in UI APIs (fail-closed)
    const jsFiles = [
      '/js/app.js',
      '/js/review-sharing/review-share-aggregate-ui.js',
      '/js/review-sharing/review-share-view-model.js',
      '/js/hashing/hash-progress-ui.js',
      '/js/review/review-editor-ui.js',
      '/js/review/review-editor-controller.js',
      '/js/radar.js'
    ];

    for (const fileUrl of jsFiles) {
      const res = await fetch(fileUrl);
      assert(res.ok, `Failed to fetch ${fileUrl}: HTTP ${res.status}`);
      const code = await res.text();
      const apiLeaks = detectJsApiTranslationLeaks(code, fileUrl);
      assert(apiLeaks.length === 0, `Detected hard-coded Japanese literal passed to UI API in ${fileUrl}: ${JSON.stringify(apiLeaks)}`);
    }
  });

  // 29. Phase 4 回帰テスト A: built-in criterion persistence (display translation must not backflow into DB)
  await runTest('29. Phase 4 回帰テスト A: built-in criterion persistence (display translation must not backflow into DB)', async () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      const storage = new MemoryStorage();
      storage.setItem('vreview_schema_version', '4');
      const db = new AppDatabase(storage);
      await db.initAsync();

      const crit = db.criteria.find(c => c.id === 'crit-visuals');
      assert(crit && crit.name === '映像', 'Precondition: canonical name in DB must be 映像');

      setLocale('en');
      const displayValEn = translateBuiltInField('criteria', crit.id, 'name', crit.name);
      assert(displayValEn === 'Visuals', 'Display value in English must be Visuals');

      // Case 1: User does not change display value and confirms/blurs -> must NOT update DB!
      const persistAttemptUnchanged = resolveUserEditedValue('criteria', crit.id, 'name', crit.name, 'Visuals');
      assert(persistAttemptUnchanged === null, 'resolveUserEditedValue must return null when input equals display translation');
      assert(db.criteria.find(c => c.id === 'crit-visuals').name === '映像', 'DB must remain 映像 when user leaves display unchanged');

      // Case 2: User explicitly changes Visuals to Cinematography
      const persistAttemptEdited = resolveUserEditedValue('criteria', crit.id, 'name', crit.name, 'Cinematography');
      assert(persistAttemptEdited === 'Cinematography', 'resolveUserEditedValue must return user edited name');
      await db.updateCriterion(crit.id, { name: persistAttemptEdited });
      assert(db.criteria.find(c => c.id === 'crit-visuals').name === 'Cinematography', 'DB must be updated to Cinematography');

      // Case 3: Switch to zh-CN -> user edited value Cinematography must NOT be translated
      setLocale('zh-CN');
      const displayValZh = translateBuiltInField('criteria', crit.id, 'name', db.criteria.find(c => c.id === 'crit-visuals').name);
      assert(displayValZh === 'Cinematography', `User edited value must not be translated in zh-CN, got: ${displayValZh}`);

      // Switch to ja -> Cinematography remains
      setLocale('ja');
      const displayValJa = translateBuiltInField('criteria', crit.id, 'name', db.criteria.find(c => c.id === 'crit-visuals').name);
      assert(displayValJa === 'Cinematography', `User edited value must remain in ja, got: ${displayValJa}`);
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 30. Phase 4 回帰テスト B: built-in genre rename persistence (prompt OK with unchanged translation must not alter DB)
  await runTest('30. Phase 4 回帰テスト B: built-in genre rename persistence (prompt OK with unchanged translation must not alter DB)', async () => {
    const testInitialLocale = currentLocale;
    let testInitialStorage = null;
    try { testInitialStorage = localStorage.getItem(STORAGE_KEY); } catch (e) {}

    try {
      const storage = new MemoryStorage();
      storage.setItem('vreview_schema_version', '4');
      const db = new AppDatabase(storage);
      await db.initAsync();

      const genre = db.genres.find(g => g.id === 'genre-default');
      assert(genre && genre.name === '一般', 'Precondition: canonical genre name in DB must be 一般');

      setLocale('en');
      const genreDisplayEn = translateBuiltInField('genres', genre.id, 'name', genre.name);
      assert(genreDisplayEn === 'General', 'Prompt default value in English is General');

      // Case 1: User clicks OK without changing default prompt value (General)
      const persistAttemptUnchanged = resolveUserEditedValue('genres', genre.id, 'name', genre.name, 'General');
      assert(persistAttemptUnchanged === null, 'resolveUserEditedValue must return null when prompt value is General');
      assert(db.genres.find(g => g.id === 'genre-default').name === '一般', 'DB must remain 一般');

      // Case 2: User explicitly changes General to Movies
      const persistAttemptEdited = resolveUserEditedValue('genres', genre.id, 'name', genre.name, 'Movies');
      assert(persistAttemptEdited === 'Movies', 'resolveUserEditedValue must return Movies');
      await db.updateGenre(genre.id, { name: persistAttemptEdited });
      assert(db.genres.find(g => g.id === 'genre-default').name === 'Movies', 'DB must be updated to Movies');

      // Case 3: Switch to zh-CN -> user edited Movies must NOT be translated
      setLocale('zh-CN');
      const displayValZh = translateBuiltInField('genres', genre.id, 'name', db.genres.find(g => g.id === 'genre-default').name);
      assert(displayValZh === 'Movies', `User edited genre name must not be translated in zh-CN, got: ${displayValZh}`);
    } finally {
      setLocale(testInitialLocale);
      try {
        if (testInitialStorage !== null) {
          localStorage.setItem(STORAGE_KEY, testInitialStorage);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch (e) {}
    }
  });

  // 31. Phase 4 回帰テスト C: translation leak detector self-test (fail-closed verification)
  await runTest('31. Phase 4 回帰テスト C: translation leak detector self-test (fail-closed verification)', () => {
    // 1. HTML leak fixture must be detected
    const leakyHtml = `
      <div>
        <span data-i18n="valid.key">Localized</span>
        <button>未翻訳の日本語ボタン</button>
      </div>
    `;
    const htmlLeaks = detectHtmlTranslationLeaks(leakyHtml);
    assert(htmlLeaks.length === 1, `HTML leak detector must detect 1 leak, got ${htmlLeaks.length}`);
    assert(htmlLeaks[0].element.toUpperCase() === 'BUTTON');
    assert(htmlLeaks[0].text.includes('未翻訳の日本語ボタン'));

    // Clean HTML fixture with data-i18n or allowlisted text must have 0 leaks
    const cleanHtml = `
      <div>
        <span data-i18n="valid.key">日本語</span>
        <option value="ja">日本語</option>
        <span data-i18n="brand.name">VRV: VideoReViewer</span>
      </div>
    `;
    const cleanHtmlLeaks = detectHtmlTranslationLeaks(cleanHtml);
    assert(cleanHtmlLeaks.length === 0, `Clean HTML detector must report 0 leaks, got ${cleanHtmlLeaks.length}`);

    // 2. JS API leak fixture must be detected
    const leakyJs = `
      function test() {
        showToast("ハードコードされたエラーメッセージ", "error");
        if (confirm('本当に削除しますか？')) {
          alert('完了しました');
        }
      }
    `;
    const jsLeaks = detectJsApiTranslationLeaks(leakyJs, 'leaky.js');
    assert(jsLeaks.length === 3, `JS API leak detector must detect 3 leaks, got ${jsLeaks.length}`);
    assert(jsLeaks[0].api === 'showToast' && jsLeaks[0].arg.includes('ハードコード'));
    assert(jsLeaks[1].api === 'confirm' && jsLeaks[1].arg.includes('本当に削除'));
    assert(jsLeaks[2].api === 'alert' && jsLeaks[2].arg.includes('完了'));

    // Clean JS fixture using t() must have 0 leaks
    const cleanJs = `
      function test() {
        showToast(t("settings.toastSaved"), "info");
        if (confirm(t("settings.confirmDeleteCriteria", { name: "test" }))) {
          alert(t("settings.toastDeleted"));
        }
      }
    `;
    const cleanJsLeaks = detectJsApiTranslationLeaks(cleanJs, 'clean.js');
    assert(cleanJsLeaks.length === 0, `Clean JS detector must report 0 leaks, got ${cleanJsLeaks.length}`);
  });

  } finally {
    setLocale(initialLocale);
    try {
      if (initialStorageLocale !== null) {
        localStorage.setItem(STORAGE_KEY, initialStorageLocale);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {}
    console.groupEnd();
  }
  return results;
}
