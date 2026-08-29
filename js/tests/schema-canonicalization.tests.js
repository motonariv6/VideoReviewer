// schema-canonicalization.tests.js - Regression tests for legacy backup and database canonicalization
import { AppDatabase, canonicalizeDatabaseData } from '../db.js';
import { MemoryStorage } from '../tests.js';

export async function runSchemaCanonicalizationTests() {
  const results = [];

  const assert = (condition, message) => {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  };

  const runTest = async (name, fn) => {
    try {
      await fn();
      const res = { name, passed: true, error: null };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    } catch (e) {
      const res = { name, passed: false, error: e.message };
      results.push(res);
      if (typeof window !== 'undefined' && typeof window.__onTestResult__ === 'function') {
        window.__onTestResult__(res);
      }
    }
  };

  console.group('Group 23: Schema Canonicalization & Legacy Data Recovery Tests');

  // Test helper to generate a default mock database state
  const createMockDb = (presetData = {}) => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    const defaultData = {
      reviewers: [
        { id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ],
      media_assets: [],
      file_locations: [],
      rating_criteria: [],
      video_reviews: [],
      criterion_ratings: [],
      tags: [],
      review_tags: [],
      timeline_notes: [],
      directory_sources: [],
      genres: [
        { id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分', displayOrder: 1, isActive: true, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }
      ],
      evaluation_templates: [],
      pending_shared_reviews: []
    };

    const merged = { ...defaultData, ...presetData };
    for (const [key, value] of Object.entries(merged)) {
      memStorage.setItem('vreview_' + key, JSON.stringify(value));
    }

    const db = new AppDatabase(memStorage, 'vreview_');
    return db;
  };

  // --- TESTS A - P ---

  await runTest('A. template-Xのみ -> temp-Xへ変換、reference保持', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [{ id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content' }];
    const rating_criteria = [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates[0].id === 'temp-default', 'ID template-default should be converted to temp-default');
    assert(res.rating_criteria[0].templateId === 'temp-default', 'criteria templateId should reference temp-default');
  });

  await runTest('B. temp-Xのみ -> no-op', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分', createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content', createdAt: '2026-08-29T12:00:00Z', updatedAt: '2026-08-29T12:00:00Z' }];
    const rating_criteria = [{ id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true }];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === false, 'Should not modify canonical temp-X');
  });

  await runTest('C. template-X / temp-X共存、内容同一 -> canonicalへ安全merge', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' }
    ];
    const rating_criteria = []; // Both templates are empty and identical in relation

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 1, 'Duplicate template-default should be merged and removed');
    assert(res.evaluation_templates[0].id === 'temp-default', 'Should keep temp-default');
  });

  await runTest('C-2. criteriaIdsは同じだがactual relationが異なる -> mergeしない (temp-legacy-Xに分離)', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content' }
    ];
    // Metadata says crit-content, but legacy references crit-legacy, violating relation safety
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-legacy', name: 'レガシー内容', templateId: 'template-default', displayOrder: 1, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 2, 'Should separate due to mismatch relation');
    assert(res.evaluation_templates.some(t => t.id === 'temp-legacy-default'), 'Should create temp-legacy-default');
  });

  await runTest('C-3. criteriaIdsは異なる/欠落しているがactual relationが同一 -> 同一判定 (安全マージ)', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: null } // missing
    ];
    const rating_criteria = []; // Both relations are empty (identical)

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 1, 'Should merge successfully');
  });

  await runTest('C-4. merge後 criteriaIdsと rating_criteria relation が一致すること', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-something' }, // mismatch metadata
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' }
    ];
    const rating_criteria = []; // empty actual relations

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 2, 'Should not merge due to metadata-relation conflict');

    const legacyT = res.evaluation_templates.find(t => t.id === 'temp-legacy-default');
    assert(legacyT !== undefined, 'Should be separated into temp-legacy-default');
    // The mismatching criteriaIds must be updated and synced with the actual relation (empty)
    assert(legacyT.criteriaIds === '', 'criteriaIds should be synced with actual empty relation: ' + legacyT.criteriaIds);
  });

  // --- NEW TEMPLATE NAME MERGE CONFLICT TESTS ---

  await runTest('C-5. same genre / same empty relation / different non-empty name -> mergeしない、temp-legacy-Xへ分離', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '通常評価', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: '特別評価', criteriaIds: '' }
    ];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify');
    assert(res.evaluation_templates.length === 2, 'Must not merge templates due to name conflict');
    assert(res.evaluation_templates.some(t => t.id === 'temp-legacy-default'), 'Should separate into temp-legacy-default');
  });

  await runTest('C-6. same genre / same relation / same name -> safe merge', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '通常評価', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: '通常評価', criteriaIds: '' }
    ];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify');
    assert(res.evaluation_templates.length === 1, 'Should safely merge identical templates');
    assert(res.evaluation_templates[0].id === 'temp-default', 'Keep temp-default');
  });

  await runTest('C-7. name missing vs existing name -> 欠落側が補完され、既存のnameを維持してsafe merge', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '既存のカスタム評価', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: '' } // missing name
    ];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify');
    assert(res.evaluation_templates.length === 1, 'Should merge because missing name is complementary');
    assert(res.evaluation_templates[0].name === '既存のカスタム評価', 'Should preserve existing name');
  });

  // --- NEW TEMPLATE NAME MERGE PRIORITY TEST (C-7-2) ---

  await runTest('C-7-2. canonical name missing / legacy custom nameあり -> merge後custom nameが完全保持されること', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: null, criteriaIds: '' }, // canonical missing name
      { id: 'template-default', genreId: 'genre-default', name: 'ユーザー設定名', criteriaIds: '' } // legacy custom name
    ];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify');
    assert(res.evaluation_templates.length === 1, 'Should merge successfully');
    assert(res.evaluation_templates[0].name === 'ユーザー設定名', 'Must preserve legacy custom name: ' + res.evaluation_templates[0].name);
  });

  // --- NEW CRITERIAIDS PRESERVATION TESTS ---

  await runTest('C-8. canonical templateで criteriaIdsに active + inactive criterionが存在 -> criteriaIdsが変更されないこと', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content,crit-inactive', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-inactive', name: '無効基準', templateId: 'temp-default', displayOrder: 2, isActive: false }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === false, 'Should not modify as it is canonical and has criteriaIds already');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-content,crit-inactive', 'Must preserve inactive criteria inside existing criteriaIds');
  });

  await runTest('C-9. canonical templateでcriteriaIdsの順序が既存値として存在 -> legacy修復対象でなければ勝手に並び替えないこと', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-visuals,crit-content', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-visuals', name: '映像', templateId: 'temp-default', displayOrder: 2, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === false, 'Should not modify as it is canonical and has criteriaIds');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-visuals,crit-content', 'Must not reorder existing custom order');
  });

  // --- NEW CRITERIAIDS PRESERVATION TESTS DURING RENAME ---

  await runTest('C-10. legacy template-X -> temp-X 単純ID rename時に criteriaIds に active + inactive criterion が存在 -> criteriaIdsが完全保持されること', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [{ id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content,crit-inactive' }];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true },
      { id: 'crit-inactive', name: '無効基準', templateId: 'template-default', displayOrder: 2, isActive: false }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify (rename)');
    assert(res.evaluation_templates[0].id === 'temp-default', 'Should rename');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-content,crit-inactive', 'Must preserve inactive criteria inside existing criteriaIds: ' + res.evaluation_templates[0].criteriaIds);
  });

  await runTest('C-11. legacy template-X -> temp-X 単純ID rename時に criteriaIds が custom order -> order保持されること', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルト区分' }];
    const evaluation_templates = [{ id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-visuals,crit-content' }];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true },
      { id: 'crit-visuals', name: '映像', templateId: 'template-default', displayOrder: 2, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should modify (rename)');
    assert(res.evaluation_templates[0].id === 'temp-default', 'Should rename');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-visuals,crit-content', 'Must preserve custom criteria order: ' + res.evaluation_templates[0].criteriaIds);
  });

  // --- REGRESSION TESTS FOR INACTIVE CRITERIA SAFE MERGING ---

  await runTest('C-12. canonical (inactive crit-old-1のみ) vs legacy (inactive crit-old-2のみ) -> mergeしない (temp-legacy-defaultへ分離)', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' }
    ];
    const rating_criteria = [
      { id: 'crit-old-1', name: '旧評価1', templateId: 'temp-default', displayOrder: 1, isActive: false },
      { id: 'crit-old-2', name: '旧評価2', templateId: 'template-default', displayOrder: 1, isActive: false }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 2, 'Should not merge because inactive criteria differ');
    assert(res.evaluation_templates.some(t => t.id === 'temp-legacy-default'), 'Should create temp-legacy-default');
  });

  // NOTE: C-13 (non-empty relation を持つ 2 template の safe merge) は、
  // rating_criteria.id がグローバルにユニークな主キーである実データモデル上、
  // 1つの criterion レコードが同時に2つの異なる templateId を参照することは不可能なため、
  // 現実的には発生しません。relation が empty である場合の safe merge は Test C にて検証されています。

  await runTest('C-14. criteriaIds欠落時の再構築で inactive criterion も criteriaIds に含まれて保持されること', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: null }
    ];
    const rating_criteria = [
      { id: 'crit-a', name: '評価A', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-old-1', name: '旧評価1', templateId: 'temp-default', displayOrder: 2, isActive: false }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 1, 'Should keep the template');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-a,crit-old-1', 'Must reconstruct criteriaIds containing inactive criterion: ' + res.evaluation_templates[0].criteriaIds);
  });

  // --- REST OF TESTS D - P ---

  await runTest('D. template-X / temp-X共存、内容相違 -> deterministic temp-legacy-Xへ変換', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-visuals' }
    ];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-visuals', name: '映像', templateId: 'template-default', displayOrder: 2, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates.length === 2, 'Both templates should be preserved since contents differ');

    const legacyT = res.evaluation_templates.find(t => t.id === 'temp-legacy-default');
    assert(legacyT !== undefined, 'template-default should be converted to temp-legacy-default due to diff content');

    const legacyC = res.rating_criteria.find(c => c.id === 'crit-visuals');
    assert(legacyC.templateId === 'temp-legacy-default', 'criteria should refer to temp-legacy-default');
  });

  await runTest('E. temp-legacy-Xまで衝突し、安全に解決不能 -> fail closed / rollback', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content' },
      { id: 'temp-legacy-default', genreId: 'genre-default', name: '一般のテンプレートレガシー', criteriaIds: 'crit-visuals' },
      { id: 'template-default', genreId: 'genre-default', name: '一般のテンプレート3', criteriaIds: 'crit-audio' }
    ];
    const rating_criteria = [
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-visuals', name: '映像', templateId: 'temp-legacy-default', displayOrder: 2, isActive: true },
      { id: 'crit-audio', name: '音声', templateId: 'template-default', displayOrder: 3, isActive: true }
    ];

    let threwError = false;
    try {
      canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    } catch (e) {
      threwError = true;
      assert(e.message.includes('collision cannot be resolved'), 'Should throw ID collision error');
    }
    assert(threwError === true, 'Should throw error when resolving legacy conflict is impossible');
  });

  await runTest('F. criteriaIds欠落 -> templateId + displayOrderから再構築', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: null }];
    const rating_criteria = [
      { id: 'crit-audio', name: '音声', templateId: 'temp-default', displayOrder: 2, isActive: true },
      { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates[0].criteriaIds === 'crit-content,crit-audio', 'Should reconstruct criteriaIds in displayOrder ASC');
  });

  await runTest('G. displayOrder同値 -> secondary key (id localeCompare) によりdeterministic', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: 'デフォルトのジャンル区分' }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: null }];
    const rating_criteria = [
      { id: 'crit-zzz', name: '音声', templateId: 'temp-default', displayOrder: 1, isActive: true },
      { id: 'crit-aaa', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true }
    ];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.evaluation_templates[0].criteriaIds === 'crit-aaa,crit-zzz', 'Should sort deterministically using ID localeCompare when displayOrder is equal');
  });

  await runTest('H. description欠落 -> compatibility default', async () => {
    const genres = [{ id: 'genre-default', name: 'アクション', displayTitle: 'アクション', description: null }];
    const evaluation_templates = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: '' }];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.genres[0].description === 'アクションのジャンル区分', 'Should set description compatibility default');
  });

  await runTest('I. template name欠落 -> genre.nameからdeterministic補完、genre無ければ"評価テンプレート"', async () => {
    const genres = [{ id: 'genre-default', name: 'ドラマ', displayTitle: 'ドラマ', description: 'ドラマ' }];
    const evaluation_templates = [
      { id: 'temp-default', genreId: 'genre-default', name: null, criteriaIds: '' },
      { id: 'temp-orphaned', genreId: 'nonexistent-genre', name: null, criteriaIds: '' }
    ];
    const rating_criteria = [];

    const res = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res.modified === true, 'Should mark modified');
    assert(res.evaluation_templates[0].name === 'ドラマのテンプレート', 'Should compile template name using genre name');
    assert(res.evaluation_templates[1].name === '評価テンプレート', 'Should fallback to 評価テンプレート when genre is missing');
  });

  await runTest('J. canonicalization 2回 -> 2回目変更なし (Idempotency)', async () => {
    const genres = [{ id: 'genre-default', name: 'アクション', displayTitle: 'アクション', description: null }];
    const evaluation_templates = [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }];
    const rating_criteria = [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }];

    const res1 = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });
    assert(res1.modified === true, 'First run should modify');

    const res2 = canonicalizeDatabaseData({
      genres: res1.genres,
      evaluation_templates: res1.evaluation_templates,
      rating_criteria: res1.rating_criteria
    });
    assert(res2.modified === false, 'Second run must not modify already canonical data');
  });

  await runTest('K. validation時とrestore時 -> canonicalized結果が完全一致 (時刻遅延時)', async () => {
    const parsedDb = {
      genres: [{ id: 'genre-default', name: 'アクション', displayTitle: 'アクション', description: null }],
      evaluation_templates: [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }],
      rating_criteria: [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }]
    };

    const db = createMockDb();

    // Simulate validation path
    const validatedDb = db.normalizeBackupData(parsedDb);

    // Simulate real delay before restore path
    await new Promise(resolve => setTimeout(resolve, 50));

    // Simulate restore path (must use original parsedDb, not the already-repaired state)
    const restoredDb = db.normalizeBackupData(parsedDb);

    assert(JSON.stringify(validatedDb.genres) === JSON.stringify(restoredDb.genres), 'genres should match completely including timestamps');
    assert(JSON.stringify(validatedDb.evaluation_templates) === JSON.stringify(restoredDb.evaluation_templates), 'templates should match completely including timestamps');
    assert(JSON.stringify(validatedDb.rating_criteria) === JSON.stringify(restoredDb.rating_criteria), 'criteria should match completely');
  });

  await runTest('L. startup canonicalization成功 -> canonical DBが永続化', async () => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    // Set legacy database values directly in mock localStorage
    memStorage.setItem('vreview_genres', JSON.stringify([{ id: 'genre-default', name: '一般', displayTitle: null, description: null }]));
    memStorage.setItem('vreview_evaluation_templates', JSON.stringify([{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }]));
    memStorage.setItem('vreview_rating_criteria', JSON.stringify([{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }]));
    memStorage.setItem('vreview_reviewers', JSON.stringify([{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]));

    const db = new AppDatabase(memStorage, 'vreview_');
    await db.initAsync(); // Triggers startup canonicalization

    // Read values back from localStorage to verify persistence
    const savedGenres = JSON.parse(memStorage.getItem('vreview_genres'));
    const savedTemplates = JSON.parse(memStorage.getItem('vreview_evaluation_templates'));
    const savedCriteria = JSON.parse(memStorage.getItem('vreview_rating_criteria'));

    assert(savedGenres[0].displayTitle === '一般', 'displayTitle should be persisted in localStorage');
    assert(savedTemplates[0].id === 'temp-default', 'temp-default template ID should be persisted in localStorage');
    assert(savedCriteria[0].templateId === 'temp-default', 'criteria templateId reference should be persisted in localStorage');
  });

  await runTest('M. startup保存失敗 -> snapshotへ完全rollback (部分保存されたlocalStorageの復旧検証)', async () => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    const origGenres = [{ id: 'genre-default', name: '一般', displayTitle: null, description: null }];
    const origTemplates = [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }];
    const origCriteria = [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }];

    memStorage.setItem('vreview_genres', JSON.stringify(origGenres));
    memStorage.setItem('vreview_evaluation_templates', JSON.stringify(origTemplates));
    memStorage.setItem('vreview_rating_criteria', JSON.stringify(origCriteria));
    memStorage.setItem('vreview_reviewers', JSON.stringify([{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]));

    const db = new AppDatabase(memStorage, 'vreview_');

    // Make the third saveTable (rating_criteria) throw an error
    const originalSaveTable = db._saveTable;
    db._saveTable = (table, data) => {
      if (table === 'rating_criteria') {
        throw new Error('Forced localStorage write failure on rating_criteria');
      }
      originalSaveTable.call(db, table, data);
    };

    let threwError = false;
    try {
      await db.initAsync();
    } catch (e) {
      threwError = true;
      assert(e.message.includes('Forced localStorage write failure'), 'Should throw forced failure');
    }

    db._saveTable = originalSaveTable;
    assert(threwError === true, 'Should have failed startup');

    // Verify localStorage genres and templates are rolled back to original legacy values
    const storedGenres = JSON.parse(memStorage.getItem('vreview_genres'));
    const storedTemplates = JSON.parse(memStorage.getItem('vreview_evaluation_templates'));
    const storedCriteria = JSON.parse(memStorage.getItem('vreview_rating_criteria'));

    assert(storedGenres[0].displayTitle === null, 'localStorage genres must roll back');
    assert(storedTemplates[0].id === 'template-default', 'localStorage templates must roll back');
    assert(storedCriteria[0].templateId === 'template-default', 'localStorage criteria must roll back');

    // Verify memory values also roll back
    assert(db.genres[0].displayTitle === null, 'memory genres must roll back');
    assert(db.templates[0].id === 'template-default', 'memory templates must roll back');
  });

  await runTest('N. startup canonical data -> _saveTable()が呼ばれず、localStorageも書き換わらない', async () => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    const canonicalGenre = { id: 'genre-default', name: '一般', displayTitle: '一般', description: '一般のジャンル区分', displayOrder: 1, isActive: true, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' };
    const canonicalTemplate = { id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' };
    const canonicalCriteria = { id: 'crit-content', name: '内容', templateId: 'temp-default', displayOrder: 1, isActive: true };

    memStorage.setItem('vreview_genres', JSON.stringify([canonicalGenre]));
    memStorage.setItem('vreview_evaluation_templates', JSON.stringify([canonicalTemplate]));
    memStorage.setItem('vreview_rating_criteria', JSON.stringify([canonicalCriteria]));
    memStorage.setItem('vreview_reviewers', JSON.stringify([{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]));

    const db = new AppDatabase(memStorage, 'vreview_');

    let saveTableCalls = [];
    const originalSaveTable = db._saveTable;
    db._saveTable = (table, data) => {
      saveTableCalls.push({ table, data });
      originalSaveTable.call(db, table, data);
    };

    const beforeGenres = memStorage.getItem('vreview_genres');

    await db.initAsync();

    db._saveTable = originalSaveTable;

    assert(saveTableCalls.length === 0, '_saveTable should not be called when data is already canonical');
    assert(memStorage.getItem('vreview_genres') === beforeGenres, 'localStorage value should not change');
  });

  await runTest('O. legacy backup -> normalize -> strict validation -> restore -> export -> strict validation -> fresh restore', async () => {
    const legacyDb = {
      schemaVersion: 4,
      reviewers: [{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      genres: [{ id: 'genre-default', name: '一般', displayTitle: null, description: null }],
      evaluation_templates: [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }],
      rating_criteria: [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }],
      media_assets: [], file_locations: [], video_reviews: [], criterion_ratings: [], tags: [], review_tags: [], timeline_notes: [], directory_sources: [], pending_shared_reviews: []
    };

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 0, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 }
    };

    const db = createMockDb();

    // 1. normalize -> validation
    const valRes = db.validateBackupData(legacyDb, manifest, []);
    assert(valRes.isValid === true, 'Should pass strict validation after normalization: ' + valRes.fatalErrors.join(', '));

    // 2. restore
    await db.restoreWithRollback(valRes.repairedDb, []);

    assert(db.genres[0].displayTitle === '一般', 'Should be canonicalized upon restore');
    assert(db.templates[0].id === 'temp-default', 'ID should be temp-default upon restore');

    // 3. export simulation
    const exportedDb = {
      schemaVersion: 4,
      reviewers: db.reviewers,
      genres: db.genres,
      evaluation_templates: db.templates,
      rating_criteria: db.criteria,
      media_assets: db.mediaAssets,
      file_locations: db.fileLocations,
      video_reviews: db.reviews,
      criterion_ratings: db.criterionRatings,
      tags: db.tags,
      review_tags: db.reviewTags,
      timeline_notes: db.timelineNotes,
      directory_sources: db.directorySources,
      pending_shared_reviews: db.pendingSharedReviews
    };

    // 4. strict validation on exported data
    const dbFresh = createMockDb();
    const valFresh = dbFresh.validateBackupData(exportedDb, manifest, []);
    assert(valFresh.isValid === true, 'Exported ZIP data must pass strict validation cleanly: ' + valFresh.fatalErrors.join(', '));

    // 5. fresh restore
    const freshRestoreSucceeded = await dbFresh.restoreWithRollback(valFresh.repairedDb, []);
    assert(freshRestoreSucceeded === true, 'Fresh restore should complete successfully');
  });

  await runTest('P. 既存review / tags / timeline / criteria / genre relationが保持される', async () => {
    const legacyDbPreset = {
      genres: [{ id: 'genre-default', name: '一般', displayTitle: null, description: null }],
      evaluation_templates: [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }],
      rating_criteria: [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }],
      media_assets: [{ id: 'vid-1', contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111', hashAlgorithm: 'SHA-256', quickHash: 'q_1', hashStatus: 'completed', fileSize: 100, duration: 10, displayTitle: 'Video 1', genreId: 'genre-default', identityStatus: 'normal', identityConflictGroupId: null, createdAt: '', updatedAt: '' }],
      video_reviews: [{ id: 'rev-1', mediaAssetId: 'vid-1', reviewerId: 'reviewer-owner-default', origin: 'local', overallScore: 5, comment: 'Great', createdAt: '', updatedAt: '' }],
      criterion_ratings: [{ id: 'rate-1', videoReviewId: 'rev-1', criterionId: 'crit-content', score: 5 }],
      tags: [{ id: 'tag-1', name: 'Travel' }],
      review_tags: [{ id: 'rt-1', videoReviewId: 'rev-1', tagId: 'tag-1', createdAt: '' }],
      timeline_notes: [{ id: 'note-1', videoReviewId: 'rev-1', mediaAssetId: 'vid-1', timestampSeconds: 5, timestampLabel: '00:05', comment: 'Highlight', createdAt: '' }]
    };

    const db = createMockDb(legacyDbPreset);
    await db.initAsync(); // Triggers canonicalization

    // Verify properties and relations
    assert(db.reviews.length === 1, 'Reviews count must remain the same');
    assert(db.reviews[0].overallScore === 5, 'overallScore must be preserved');
    assert(db.reviewTags.length === 1 && db.reviewTags[0].tagId === 'tag-1', 'review tag relation must remain intact');
    assert(db.timelineNotes.length === 1 && db.timelineNotes[0].comment === 'Highlight', 'timeline comment must remain intact');
    assert(db.criterionRatings.length === 1 && db.criterionRatings[0].score === 5, 'criterion ratings must remain intact');
  });

  // --- NEW DETERMINISM TESTS ---

  await runTest('Q. 同一legacy inputを時間を空けて2回canonicalizeしても完全一致、かつ時計の変更に影響されない', async () => {
    const genres = [{ id: 'genre-default', name: '一般', displayTitle: null, description: null }];
    const evaluation_templates = [{ id: 'template-default', genreId: 'genre-default', name: null, criteriaIds: null }];
    const rating_criteria = [{ id: 'crit-content', name: '内容', templateId: 'template-default', displayOrder: 1, isActive: true }];

    // 1st run
    const res1 = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });

    // Simulate real time delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // 2nd run from the SAME legacy input
    const res2 = canonicalizeDatabaseData({ genres, evaluation_templates, rating_criteria });

    assert(JSON.stringify(res1.genres) === JSON.stringify(res2.genres), 'genres output should be deepEqual regardless of delay');
    assert(JSON.stringify(res1.evaluation_templates) === JSON.stringify(res2.evaluation_templates), 'templates output should be deepEqual regardless of delay');
    assert(res1.genres[0].createdAt === '1970-01-01T00:00:00.000Z', 'Default timestamp must be Unix epoch sentinel');

    // Verify custom timestamps are NOT overwritten if they already exist
    const genresWithCustomTime = [{ id: 'genre-default', name: '一般', displayTitle: '一般', description: '説明', createdAt: '2020-01-01T12:00:00Z', updatedAt: '2020-01-01T12:00:00Z' }];
    const templatesWithCustomTime = [{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content', createdAt: '2020-01-01T12:00:00Z', updatedAt: '2020-01-01T12:00:00Z' }];

    const resCustom = canonicalizeDatabaseData({
      genres: genresWithCustomTime,
      evaluation_templates: templatesWithCustomTime,
      rating_criteria
    });

    assert(resCustom.genres[0].createdAt === '2020-01-01T12:00:00Z', 'Existing createdAt must not be overwritten');
    assert(resCustom.evaluation_templates[0].createdAt === '2020-01-01T12:00:00Z', 'Existing createdAt must not be overwritten');
  });

  await runTest('R. validateV4Structureが startup時に criteria.templateId の整合性を正しく検証できること', async () => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    // Force legacy shortfall on genres (displayTitle is null) to trigger canonicalization validation
    memStorage.setItem('vreview_genres', JSON.stringify([{ id: 'genre-default', name: '一般', displayTitle: null, description: '一般のジャンル区分', displayOrder: 1, isActive: true, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }]));
    memStorage.setItem('vreview_evaluation_templates', JSON.stringify([{ id: 'temp-default', genreId: 'genre-default', name: '一般のテンプレート', criteriaIds: 'crit-content', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }]));
    // Broken DB state where rating_criteria references a non-existent template
    memStorage.setItem('vreview_rating_criteria', JSON.stringify([{ id: 'crit-content', name: '内容', templateId: 'non-existent-template', displayOrder: 1, isActive: true }]));
    memStorage.setItem('vreview_reviewers', JSON.stringify([{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]));

    const db = new AppDatabase(memStorage, 'vreview_');

    let threwError = false;
    try {
      await db.initAsync(); // Should trigger canonicalization due to genres.displayTitle, then fail validation
    } catch (e) {
      threwError = true;
      assert(e.message.includes('non-existent template'), 'Should fail validation due to broken referential integrity: ' + e.message);
    }

    assert(threwError === true, 'Integrity check must fail startup when referential integrity is broken');
  });

  // --- NEW DEFENSIVE PRE-VALIDATION TEST ---

  await runTest('S. malformed input handling -> canonicalizer が TypeError を発生させず、Schema validation が正常にエラーを返すこと', async () => {
    const malformedDb = {
      schemaVersion: 4,
      reviewers: [{ id: 'reviewer-owner-default', displayName: '自分', isLocal: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      genres: [null, { id: 'genre-default', name: '一般' }], // contains null genre
      evaluation_templates: [
        null, // null template element
        { id: 999, genreId: 'genre-default' }, // template ID is non-string (number)
        { id: 'template-default', genreId: null, name: '一般' } // missing genreId reference
      ],
      rating_criteria: [
        null, // contains null criterion
        { id: 'crit-content', name: '内容', templateId: 444 } // criterion templateId is non-string
      ],
      media_assets: [], file_locations: [], video_reviews: [], criterion_ratings: [], tags: [], review_tags: [], timeline_notes: [], directory_sources: [], pending_shared_reviews: []
    };

    const manifest = {
      application: 'VideoReviewer',
      schemaVersion: 4,
      createdAt: new Date().toISOString(),
      counts: { media_assets: 0, file_locations: 0, reviews: 0, images: 0, reviewers: 1, review_tags: 0, pending_shared_reviews: 0 }
    };

    const db = createMockDb();

    // 1. normalization (Must not throw TypeError)
    let repairedDb = null;
    let threwTypeError = false;
    try {
      repairedDb = db.normalizeBackupData(malformedDb);
    } catch (e) {
      threwTypeError = true;
      console.error(e);
    }

    assert(threwTypeError === false, 'canonicalizer should not crash on malformed inputs');
    assert(repairedDb !== null, 'repairedDb should be generated');

    // Verify invalid template (999) and null elements are RETAINED in repairedDb for subsequent validator checks
    assert(repairedDb.evaluation_templates.length === 3, 'Must retain null template and invalid non-string template. Found: ' + repairedDb.evaluation_templates.length);
    assert(repairedDb.evaluation_templates[0] === null, 'Must retain null element');
    assert(repairedDb.evaluation_templates[1].id === 999, 'Must retain non-string template ID element');

    // 2. validation (Must successfully raise validation errors on these retained elements)
    const valRes = db.validateBackupData(malformedDb, manifest, []);
    assert(valRes.isValid === false, 'Malformed data must be flagged as invalid');
    assert(valRes.fatalErrors.length > 0, 'Should have fatal validation errors');

    // Check if the validation reports the null object and the non-string ID template using localized message match
    const errorsJoined = valRes.fatalErrors.join(' | ');
    assert(errorsJoined.includes('オブジェクトではありません') || errorsJoined.includes('is not an object'), 'Validator should report the null objects: ' + errorsJoined);
    assert(errorsJoined.includes('型 [string] ではありません') || errorsJoined.includes('id pattern is invalid'), 'Validator should catch non-string id 999: ' + errorsJoined);

    // 3. Test top-level non-array handling (Must not crash canonicalizer)
    const nonArrayDb = {
      genres: {}, // object instead of array
      evaluation_templates: 'invalid_string', // string instead of array
      rating_criteria: 12345 // number instead of array
    };

    let nonArrayRepaired = null;
    let threwNonArrayCrash = false;
    try {
      nonArrayRepaired = db.normalizeBackupData(nonArrayDb);
    } catch (e) {
      threwNonArrayCrash = true;
      console.error(e);
    }

    assert(threwNonArrayCrash === false, 'canonicalizer should not crash on top-level non-array properties');
    assert(nonArrayRepaired !== null, 'nonArrayRepaired should be returned');
    assert(typeof nonArrayRepaired.genres === 'object' && !Array.isArray(nonArrayRepaired.genres), 'Must preserve top-level non-array genres structure');
    assert(nonArrayRepaired.evaluation_templates === 'invalid_string', 'Must preserve top-level non-array templates');
  });

  console.groupEnd();
  return results;
}
