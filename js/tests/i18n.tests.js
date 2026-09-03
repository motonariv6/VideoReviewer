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
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { importPackage, importSharedReviewItem, DEFAULT_SHARED_REVIEWER_NAME } from '../review-sharing/review-share-importer.js';
import { buildSharedReviewViewModel, getReviewerDisplayName } from '../review-sharing/review-share-view-model.js';

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
    assert(getReviewerDisplayName(reviewerJa) === '共有审阅者', `zh-CN UI should resolve to '共有审阅者', got '${getReviewerDisplayName(reviewerJa)}'`);

    // Verify 3: Full ViewModel integration test across ja, en, zh-CN
    setLocale('ja');
    const vmJa = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmJa.reviewers[0].displayName === '共有レビュアー', `vmJa: Expected '共有レビュアー', got '${vmJa.reviewers[0].displayName}'`);

    setLocale('en');
    const vmEn = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmEn.reviewers[0].displayName === 'Shared Reviewer', `vmEn: Expected 'Shared Reviewer', got '${vmEn.reviewers[0].displayName}'`);

    setLocale('zh-CN');
    const vmZh = buildSharedReviewViewModel({ reviews: dbJa.reviews, reviewers: dbJa.reviewers, db: dbJa });
    assert(vmZh.reviewers[0].displayName === '共有审阅者', `vmZh: Expected '共有审阅者', got '${vmZh.reviewers[0].displayName}'`);

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
