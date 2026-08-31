import {
  t,
  setLocale,
  currentLocale,
  normalizeLocale,
  estimateLocale,
  initI18n,
  translateDOM,
  translateBuiltInField,
  LOCALES,
  STORAGE_KEY
} from '../i18n.js';

export async function runI18nTests() {
  console.group('i18n Foundation Tests');
  const results = [];

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

  console.groupEnd();
  return results;
}
