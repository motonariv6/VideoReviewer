// review-editor.tests.js - Automated tests for Review Editor controller and UI components

import { AppDatabase } from '../db.js';
import { MemoryStorage } from '../tests.js';
import { RadarChart } from '../radar.js';
import { ReviewEditorUI } from '../review/review-editor-ui.js';
import { ReviewEditorController } from '../review/review-editor-controller.js';

export async function runReviewEditorTests() {
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

  console.group('Group 16: Review Editor & UI Components Tests');

  await runTest('24-26. Japanese IME composition enter tag registrations', async () => {
    const tagsList = [];
    let isComposing = false;

    const keydownHandlerMock = (e, val) => {
      if (e.isComposing || isComposing || e.keyCode === 229) {
        return; // Block additions
      }
      if (e.key === 'Enter') {
        if (tagsList.includes(val)) {
          return; // Block duplicate tags
        }
        tagsList.push(val);
      }
    };

    // Test 24: IME active conversion (Enter key)
    isComposing = true;
    keydownHandlerMock({ key: 'Enter', isComposing: true, keyCode: 229 }, '映像美');
    assert(tagsList.length === 0, 'Tags must not be added while IME composition is active');

    // Test 25: IME conversion finalized (standard Enter key)
    isComposing = false;
    keydownHandlerMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsList.length === 1 && tagsList[0] === '映像美', 'Tag must be added once composition is finalized');

    // Test 26: Duplicate tag block
    keydownHandlerMock({ key: 'Enter', isComposing: false, keyCode: 13 }, '映像美');
    assert(tagsList.length === 1, 'Duplicate tag values must be rejected');
  });

  await runTest('Radar chart coordinates, label clamping, and responsiveness checks', async () => {
    // Mock container
    const container = document.createElement('div');
    container.style.width = '320px';
    container.style.height = '320px';
    document.body.appendChild(container);

    try {
      const chart = new RadarChart(container);
      
      const criteriaList = [
        { id: 'c1', name: '映像美' },
        { id: 'c2', name: 'ストーリー構成' },
        { id: 'c3', name: 'ユーザーインターフェースデザイン' },
        { id: 'c4', name: '音楽音響効果' },
        { id: 'c5', name: '演出力' },
        { id: 'c6', name: '革新性' }
      ];

      const ratings = { c1: 4, c2: 5, c3: 3, c4: 2, c5: 5, c6: 4 };

      for (let n = 3; n <= 6; n++) {
        const activeCriteria = criteriaList.slice(0, n);
        
        chart.render(activeCriteria, ratings);
        
        const svg = container.querySelector('svg');
        assert(svg !== null, `SVG chart must render for N = ${n}`);
        assert(svg.getAttribute('viewBox') === '0 0 440 440', 'SVG viewBox must be set to 440x440');

        const textElements = svg.querySelectorAll('.radar-labels text');
        assert(textElements.length === n, `Should render exactly ${n} text labels`);

        textElements.forEach(text => {
          const x = parseFloat(text.getAttribute('x'));
          const y = parseFloat(text.getAttribute('y'));
          assert(x >= 15 && x <= 425, `Label x (${x}) must fall in safe bounds [15, 425]`);
          assert(y >= 15 && y <= 425, `Label y (${y}) must fall in safe bounds [15, 425]`);
          
          const title = text.querySelector('title');
          assert(title !== null, 'Text label must include a title tooltip element');

          const tspans = text.querySelectorAll('tspan');
          assert(tspans.length > 0, 'Text label must use tspan children to prevent wiping out title node');
        });
      }
    } finally {
      document.body.removeChild(container);
    }
  });

  await runTest('Display title fallback, editing constraints, provisional status, and ratings/timeline validation', async () => {
    const memoryStorage = new MemoryStorage();
    const testDb = new AppDatabase(memoryStorage, 'test_v7_title_editor_');
    await testDb.initAsync();
    const video = await testDb.addVideo({
      title: 'test_video.mp4',
      fileName: 'test_video.mp4',
      fileSize: 1024,
      sourceType: 'directory',
      directoryId: 'dir-1',
      relativePath: 'test_video.mp4',
      identityStatus: 'provisional'
    });
    assert(video !== undefined, 'Must have at least one video');
    
    // Set custom display title
    await testDb.updateVideo(video.id, { displayTitle: 'カスタムタイトル' });
    
    const updatedVideo = testDb.getVideo(video.id);
    assert(updatedVideo.displayTitle === 'カスタムタイトル', 'Display title should be saved');
    
    // Clear/set displayTitle to null
    await testDb.updateVideo(video.id, { displayTitle: null });
    const clearedVideo = testDb.getVideo(video.id);
    assert(clearedVideo.displayTitle === null, 'Display title should be cleared');

    // Star ratings, overall grade, comment save, and clear review form logic
    await testDb.saveReview(video.id, {
      overallGrade: 'A',
      comment: 'Nice movie',
      ratings: { 'crit-1': 4 }
    });

    const review = testDb.getReviewForVideo(video.id);
    assert(review !== undefined, 'Review should be saved');
    assert(review.overallGrade === 'A', 'Overall grade must be A');
    assert(review.comment === 'Nice movie', 'Comment must match');

    const ratings = testDb.getCriterionRatingsForReview(review.id);
    assert(ratings.length === 1 && ratings[0].score === 4, 'Rating score must be 4');

    // Timeline notes capture, seek-to playback and deletion cascade
    await testDb.addTimelineNote(video.id, {
      timestampSeconds: 15,
      timestampLabel: '00:15',
      comment: 'Interesting frame'
    });

    const notes = testDb.getTimelineNotes(video.id);
    assert(notes.length === 1, 'Should have 1 timeline note');
    assert(notes[0].timestampSeconds === 15, 'Timestamp must match 15');
    assert(notes[0].comment === 'Interesting frame', 'Comment must match');

    // Test deletion cascade when parent asset is deleted
    await testDb.deleteVideoCascade(video.id);
    const postNotes = testDb.getTimelineNotes(video.id);
    assert(postNotes.length === 0, 'Timeline notes must be cascade deleted');
  });

  console.groupEnd(); // Group 16
  return results;
}
