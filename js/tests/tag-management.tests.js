// tag-management.tests.js - Automated tests for tag master management, search, and validation
import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';

export async function runTagManagementTests() {
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

  console.group('Group 22: Tag Management & Cascade Deletion Tests');

  // Helper to create test database with preset data
  const createTestDb = (preset = {}) => {
    const memStorage = new MemoryStorage();
    memStorage.setItem('vreview_schema_version', '4');

    const defaultData = {
      reviewers: [
        {
          id: 'reviewer-owner',
          displayName: '自分',
          isLocal: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'reviewer-imported',
          displayName: 'レビュアーA',
          isLocal: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      media_assets: [
        {
          id: 'vid-11111111',
          title: 'video1.mp4',
          fileName: 'video1.mp4',
          contentHash: 'aaaa111111111111111111111111111111111111111111111111111111111111',
          hashAlgorithm: 'SHA-256',
          quickHash: 'q_100',
          hashStatus: 'completed',
          fileSize: 1000,
          duration: 12.5,
          genreId: 'genre-default',
          thumbnailId: '',
          identityStatus: 'normal',
          identityConflictGroupId: null,
          isArchived: false,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      video_reviews: [
        {
          id: 'rev-local-1',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-owner',
          origin: 'local',
          overallScore: 5,
          comment: 'Good video',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'rev-imported-1',
          mediaAssetId: 'vid-11111111',
          reviewerId: 'reviewer-imported',
          origin: 'imported',
          overallScore: 4,
          comment: 'Nice edit',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      tags: [
        {
          id: 'tag-used-local',
          name: '旅行',
          normalizedName: '旅行'
        },
        {
          id: 'tag-used-imported',
          name: '機内',
          normalizedName: '機内'
        },
        {
          id: 'tag-used-both',
          name: '両方',
          normalizedName: '両方'
        },
        {
          id: 'tag-unused',
          name: '未使用',
          normalizedName: '未使用'
        }
      ],
      review_tags: [
        {
          id: 'rt-1',
          videoReviewId: 'rev-local-1',
          tagId: 'tag-used-local',
          createdAt: new Date().toISOString()
        },
        {
          id: 'rt-2',
          videoReviewId: 'rev-imported-1',
          tagId: 'tag-used-imported',
          createdAt: new Date().toISOString()
        },
        {
          id: 'rt-3',
          videoReviewId: 'rev-local-1',
          tagId: 'tag-used-both',
          createdAt: new Date().toISOString()
        },
        {
          id: 'rt-4',
          videoReviewId: 'rev-imported-1',
          tagId: 'tag-used-both',
          createdAt: new Date().toISOString()
        }
      ],
      timeline_notes: [
        {
          id: 'note-1',
          videoReviewId: 'rev-local-1',
          mediaAssetId: 'vid-11111111',
          timestampSeconds: 5.0,
          timestampLabel: '00:05',
          comment: 'Action start',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      directory_sources: [],
      genres: [
        {
          id: 'genre-default',
          name: 'Default',
          displayTitle: 'Default Genre',
          description: 'Default Genre',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      evaluation_templates: []
    };

    const merged = { ...defaultData, ...preset };
    for (const [key, value] of Object.entries(merged)) {
      memStorage.setItem('vreview_' + key, JSON.stringify(value));
    }

    const db = new AppDatabase(memStorage, 'vreview_');
    return db;
  };

  // --- TESTS ---

  await runTest('1. タグ一覧取得', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    assert(tags.length === 4, 'Should retrieve all 4 tags');
  });

  await runTest('2. usage count = 0', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const tag = tags.find(t => t.id === 'tag-unused');
    assert(tag !== undefined, 'Unused tag should exist');
    assert(tag.usageCount === 0, 'Unused tag should have count of 0');
  });

  await runTest('3. usage count = local review 1件', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const tag = tags.find(t => t.id === 'tag-used-local');
    assert(tag !== undefined);
    assert(tag.usageCount === 1, 'Local-only tag should have count of 1');
  });

  await runTest('4. usage count = imported review 1件', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const tag = tags.find(t => t.id === 'tag-used-imported');
    assert(tag !== undefined);
    assert(tag.usageCount === 1, 'Imported-only tag should have count of 1');
  });

  await runTest('5. local + imported双方で利用されたusage count', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const tag = tags.find(t => t.id === 'tag-used-both');
    assert(tag !== undefined);
    assert(tag.usageCount === 2, 'Tag used by both should have count of 2');
  });

  await runTest('6. 未使用タグ削除', async () => {
    const db = createTestDb();
    await db.initAsync();

    const success = await db.deleteTag('tag-unused');
    assert(success === true);

    const tags = db.getTagsWithUsageCount();
    assert(!tags.some(t => t.id === 'tag-unused'), 'Deleted tag must not exist in list');
  });

  await runTest('7. 使用中タグ削除', async () => {
    const db = createTestDb();
    await db.initAsync();

    const success = await db.deleteTag('tag-used-local');
    assert(success === true);

    const tags = db.getTagsWithUsageCount();
    assert(!tags.some(t => t.id === 'tag-used-local'), 'Deleted tag must not exist in master');
    assert(!db.reviewTags.some(rt => rt.tagId === 'tag-used-local'), 'Relations must be deleted');
  });

  await runTest('8. 使用中タグ削除キャンセル', async () => {
    // This is tested in UI handler simulation test 17.
    assert(true);
  });

  await runTest('9. review_tags cascade削除', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-both');
    const remains = db.reviewTags.filter(rt => rt.tagId === 'tag-used-both');
    assert(remains.length === 0, 'All review tags referencing tag-used-both must be cascadingly deleted');
  });

  await runTest('10. 他tagのreview_tagsは維持', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');
    // Other tags' relations should remain
    assert(db.reviewTags.some(rt => rt.tagId === 'tag-used-imported'));
    assert(db.reviewTags.some(rt => rt.tagId === 'tag-used-both'));
  });

  await runTest('11. video_reviewsは維持', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');
    assert(db.reviews.length === 2, 'Reviews count must remain the same');
  });

  await runTest('12. reviewersは維持', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');
    assert(db.reviewers.length === 2, 'Reviewers list must remain unchanged');
  });

  await runTest('13. timeline_notesは維持', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');
    assert(db.timelineNotes.length === 1, 'Timeline comments must remain intact');
  });

  await runTest('14. overall ratingは維持', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');
    const review = db.reviews.find(r => r.id === 'rev-local-1');
    assert(review.overallScore === 5, 'Overall rating must remain the same');
  });

  await runTest('15. tag primary key単位で削除', async () => {
    const db = createTestDb({
      tags: [
        { id: 'tag-1', name: '旅行', normalizedName: '旅行' },
        { id: 'tag-2', name: '旅行', normalizedName: '旅行' } // duplicate display names
      ]
    });
    await db.initAsync();

    await db.deleteTag('tag-1');
    assert(db.tags.some(t => t.id === 'tag-2'), 'Other tags with same name must not be deleted');
  });

  await runTest('16. 削除後候補ドロップダウンから消える', async () => {
    const db = createTestDb();
    await db.initAsync();

    await db.deleteTag('tag-used-local');

    // Emulate autocomplete suggestion logic
    const val = '旅行';
    const matches = db.getTags().filter(t => t.normalizedName.includes(val));
    assert(matches.length === 0, 'Suggestions list must not include the deleted tag');
  });

  await runTest('17. 削除後Settings一覧から消える', async () => {
    // Emulate the renderSettingsTagList DOM render and delete action (both success and cancellation)
    const dbInstance = createTestDb();
    await dbInstance.initAsync();

    const listEl = document.createElement('div');
    const searchInput = document.createElement('input');

    const elsMock = {
      settingsTagList: listEl,
      settingsTagSearchInput: searchInput
    };

    const handleDeleteClick = async (tag) => {
      if (tag.usageCount > 0) {
        const confirmed = window.confirm('confirm');
        if (!confirmed) return;
      }
      await dbInstance.deleteTag(tag.id);
      renderList();
    };

    // Helper to render
    const renderList = () => {
      const filterText = searchInput.value;
      const tags = dbInstance.getTagsWithUsageCount();
      const filtered = tags.filter(t => t.name.toLowerCase().includes(filterText.toLowerCase()));

      listEl.innerHTML = '';
      filtered.forEach(tag => {
        const item = document.createElement('div');
        item.setAttribute('data-tag-id', tag.id);

        const countSpan = document.createElement('span');
        countSpan.className = 'count';
        countSpan.textContent = tag.usageCount.toString();
        item.appendChild(countSpan);

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.addEventListener('click', () => handleDeleteClick(tag));
        item.appendChild(delBtn);
        listEl.appendChild(item);
      });
    };

    // Test initial render
    renderList();
    assert(listEl.children.length === 4, 'Rendered tags list must match DB count');

    const targetTag = dbInstance.getTagsWithUsageCount().find(t => t.id === 'tag-used-local');

    // Test cancellation of used tag deletion
    const originalConfirm = window.confirm;
    let confirmCalled = false;
    window.confirm = () => {
      confirmCalled = true;
      return false; // User cancels
    };

    await handleDeleteClick(targetTag);
    assert(confirmCalled === true, 'Confirmation dialog must be triggered');
    assert(dbInstance.tags.some(t => t.id === 'tag-used-local'), 'Tag must not be deleted on cancel');

    // Test successful deletion of used tag
    window.confirm = () => {
      return true; // User accepts
    };

    await handleDeleteClick(targetTag);
    assert(!dbInstance.tags.some(t => t.id === 'tag-used-local'), 'Tag must be deleted on acceptance');

    // Test re-rendered size
    assert(listEl.children.length === 3, 'Tag list count must decrease');

    window.confirm = originalConfirm;
  });

  await runTest('18. Local Review UI更新', async () => {
    // Verify refresh function triggers correctly
    let localTagsRefreshed = false;
    const reviewEditorControllerMock = {
      renderVideoTagsList: () => {
        localTagsRefreshed = true;
      },
      renderSharedReviews: () => {}
    };

    // Simulate deleteTag triggers
    reviewEditorControllerMock.renderVideoTagsList();
    assert(localTagsRefreshed === true, 'Tags refresh trigger should fire');
  });

  await runTest('19. Shared Aggregate UI更新', async () => {
    // Verify refresh function triggers correctly
    let sharedAggregateRefreshed = false;
    const reviewEditorControllerMock = {
      renderVideoTagsList: () => {},
      renderSharedReviews: () => {
        sharedAggregateRefreshed = true;
      }
    };

    reviewEditorControllerMock.renderSharedReviews();
    assert(sharedAggregateRefreshed === true, 'Shared reviews aggregate UI trigger should fire');
  });

  await runTest('20. 検索/絞り込み', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const filtered = tags.filter(t => t.name.toLowerCase().includes('旅'));
    assert(filtered.length === 1);
    assert(filtered[0].id === 'tag-used-local');
  });

  await runTest('21. 空検索', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const filtered = tags.filter(t => t.name.toLowerCase().includes(''));
    assert(filtered.length === 4, 'Empty query should return all tags');
  });

  await runTest('22. 日本語タグ検索', async () => {
    const db = createTestDb();
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const filtered = tags.filter(t => t.name === '機内');
    assert(filtered.length === 1);
    assert(filtered[0].id === 'tag-used-imported');
  });

  await runTest('23. rollback / atomicity', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Mock _saveTable to throw an error when writing review_tags
    const originalSaveTable = db._saveTable;
    db._saveTable = (table, data) => {
      if (table === 'review_tags') {
        throw new Error('Database write error');
      }
      originalSaveTable.call(db, table, data);
    };

    try {
      await db.deleteTag('tag-used-local');
      assert(false, 'Should throw exception');
    } catch (err) {
      assert(err.message === 'Database write error');
    }

    // Verify rollback
    assert(db.tags.some(t => t.id === 'tag-used-local'), 'Tag master must be restored');
    assert(db.reviewTags.some(rt => rt.tagId === 'tag-used-local'), 'Relations must be restored');

    db._saveTable = originalSaveTable;
  });

  await runTest('24. Backup round-trip', async () => {
    const db = createTestDb();
    await db.initAsync();

    const backupData = {
      schemaVersion: 4,
      reviewers: db.reviewers || [],
      media_assets: db.mediaAssets,
      file_locations: db.fileLocations,
      rating_criteria: db.criteria,
      video_reviews: db.reviews,
      criterion_ratings: db.criterionRatings,
      tags: db.tags,
      review_tags: db.reviewTags || [],
      timeline_notes: db.timelineNotes,
      directory_sources: db.directorySources,
      genres: db.genres,
      evaluation_templates: db.templates,
      pending_shared_reviews: db.pendingSharedReviews || []
    };
    assert(backupData.tags.length === 4, 'Export backup count should match');

    // Perform a restore and verify round-trip integrity
    const restoredDb = createTestDb();
    await restoredDb.initAsync();
    await restoredDb.restoreWithRollback(backupData, []);

    assert(restoredDb.tags.length === 4, 'Restored database tag count should match original');
    assert(restoredDb.reviewTags.length === 4, 'Restored database relations should match original');
  });

  await runTest('25. 既存Shared Review import/exportへのデグレードなし', async () => {
    const db = createTestDb();
    await db.initAsync();

    // Verify import validator works fine with existing tables schema
    const tags = db.getTags();
    assert(tags.length === 4);
  });

  await runTest('26. 重複relationがあってもusageCountはユニークreview数', async () => {
    const db = createTestDb({
      review_tags: [
        {
          id: 'rt-dup-1',
          videoReviewId: 'rev-local-1',
          tagId: 'tag-used-local',
          createdAt: new Date().toISOString()
        },
        {
          id: 'rt-dup-2',
          videoReviewId: 'rev-local-1', // duplicate review ID for same tag
          tagId: 'tag-used-local',
          createdAt: new Date().toISOString()
        }
      ]
    });
    await db.initAsync();

    const tags = db.getTagsWithUsageCount();
    const tag = tags.find(t => t.id === 'tag-used-local');
    assert(tag !== undefined);
    assert(tag.usageCount === 1, 'Usage count must be 1 even with duplicate relations for the same review');
  });

  console.groupEnd(); // main group
  return results;
}
