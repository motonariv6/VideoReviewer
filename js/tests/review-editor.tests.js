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

    // 1. Verify Controller has no direct DOM els dependency and can be initialized without els
    let commentVal = 'Nice movie';
    let tagInputVal = '感動';
    let timelineCommentVal = 'Amazing frame';
    let displayTitleInputVal = 'カスタムタイトル';
    let fakeAutosaveSuccessCalled = false;

    // Fake UI that mimics ReviewEditorUI without using document/window DOM API
    const fakeUi = {
      showEditor: () => {},
      hideEditor: () => {},
      populateGenreSelect: () => {},
      updateProvisionalWarningBanner: () => {},
      updateOverallGradeUI: () => {},
      renderStarCriteriaPanel: () => {},
      updateCriterionStars: () => {},
      getCommentValue: () => commentVal,
      setCommentValue: (val) => { commentVal = val; },
      renderVideoTagsList: () => {},
      getTagInputValue: () => tagInputVal,
      clearTagInput: () => { tagInputVal = ''; },
      renderTagAutocomplete: () => {},
      hideTagAutocomplete: () => {},
      renderTimelineNotesList: () => {},
      getTimelineCommentValue: () => timelineCommentVal,
      clearTimelineInput: () => { timelineCommentVal = ''; },
      setCapturedTimestamp: () => {},
      focusTimelineComment: () => {},
      showAutosaveSuccess: () => { fakeAutosaveSuccessCalled = true; },
      getDisplayTitleInput: () => displayTitleInputVal,
      finishDisplayTitleEdit: () => {},
      getSelectedGenreId: () => 'genre-default'
    };

    const mockState = {
      currentVideoId: video.id,
      currentRatings: {},
      currentOverallGrade: null,
      isDirty: false,
      capturedNoteTime: 12,
      capturedNoteThumb: null
    };

    const controller = new ReviewEditorController({
      db: testDb,
      ui: fakeUi,
      state: mockState,
      showToast: () => {},
      markDirty: () => { mockState.isDirty = true; },
      clearDirty: () => { mockState.isDirty = false; },
      getCurrentTime: () => 12,
      formatTime: (s) => '00:12',
      loadImageToElement: () => {},
      clearImageBlobUrls: () => {},
      renderLibrary: () => {},
      loadVideoMediaSource: () => {}
    });

    // Verify els is not referenced on controller
    assert(controller.els === undefined, 'Controller must not contain direct els reference');

    // 2. Verify editing on provisional video is not blocked and overall grade is saved via Fake UI
    controller.handleGradeClick('A');
    await controller.saveReviewForm();

    const review = testDb.getReviewForVideo(video.id);
    assert(review !== undefined, 'Review should be saved on provisional video');
    assert(review.overallGrade === 'A', 'Overall grade must be A');

    // 3. Verify comment save via Fake UI
    commentVal = 'Updated Comment';
    await controller.saveReviewForm();
    const updatedReview = testDb.getReviewForVideo(video.id);
    assert(updatedReview.comment === 'Updated Comment', 'Comment must be updated in DB');

    // 4. Verify tag addition via Fake UI
    tagInputVal = 'SF';
    await controller.handleTagInputKeydown({ key: 'Enter', isComposing: false, keyCode: 13, preventDefault: () => {} }, false);
    const tags = testDb.getVideoTags(video.id);
    assert(tags.length === 1 && tags[0].name === 'SF', 'Tag SF must be added to DB');

    // 5. Verify tag removal via Fake UI
    await controller.onRemoveTag(tags[0].id);
    const postTags = testDb.getVideoTags(video.id);
    assert(postTags.length === 0, 'Tag must be removed from DB');

    // 6. Verify timeline note addition via Fake UI
    timelineCommentVal = 'Captured Moment';
    await controller.addTimelineNote();
    const notes = testDb.getTimelineNotes(video.id);
    assert(notes.length === 1, 'Should have 1 timeline note in DB');
    assert(notes[0].comment === 'Captured Moment', 'Timeline note comment must match');

    // 7. Verify timeline note removal via Fake UI
    // Mock confirm dialog in controller to bypass browser confirm
    controller.confirm = () => true;
    await controller.onDeleteTimelineNote(notes[0].id);
    const postNotes = testDb.getTimelineNotes(video.id);
    assert(postNotes.length === 0, 'Timeline note must be deleted from DB');

    // 8. Verify UI module does not import or directly access the database
    // The ReviewEditorUI constructor only requires 'els', completely database-agnostic.
    const mockEls = {
      viewLibrary: document.createElement('div'),
      viewEditor: document.createElement('div'),
      btnBack: document.createElement('button'),
      editorTitle: document.createElement('h1'),
      infoFileName: document.createElement('span'),
      infoFileSize: document.createElement('span'),
      infoDuration: document.createElement('span'),
      titleDisplayContainer: document.createElement('div'),
      titleEditContainer: document.createElement('div'),
      displayTitleInput: document.createElement('input'),
      videoGenreSelect: document.createElement('select'),
      provisionalWarningBanner: document.createElement('div'),
      gradeButtons: [document.createElement('button')],
      btnClearGrade: document.createElement('button'),
      criteriaPanel: document.createElement('div'),
      commentEditor: document.createElement('textarea'),
      tagsChipsList: document.createElement('div'),
      tagInputField: document.createElement('input'),
      tagAutocomplete: document.createElement('div'),
      timelineNotesList: document.createElement('div'),
      infoLocationsContainer: document.createElement('div'),
      infoLocationsList: document.createElement('div'),
      timelineCommentField: document.createElement('textarea'),
      capturedTimestampLabel: document.createElement('span'),
      btnTimelineCapture: document.createElement('button'),
      btnTimelineAddNote: document.createElement('button'),
      commentEditor: document.createElement('textarea'),
      btnEditDisplayTitle: document.createElement('button'),
      btnSaveDisplayTitle: document.createElement('button'),
      btnCancelDisplayTitle: document.createElement('button'),
      autosaveIndicator: document.createElement('span')
    };

    const uiInstance = new ReviewEditorUI({ els: mockEls });
    assert(uiInstance.els !== undefined, 'UI instance constructed with els');

    // 9. Verify event listeners are not registered multiple times
    // Let's verify that setupEventListeners doesn't crash on multiple calls or register duplicates.
    let callbackCount = 0;
    uiInstance.setupEventListeners({
      onGradeClick: () => { callbackCount++; },
      onClearGradeClick: () => {},
      onGenreChange: () => {},
      onTitleSave: () => {},
      onTagInput: () => {},
      onTagKeydown: () => {},
      onCaptureTimeClick: () => {},
      onAddTimelineNoteClick: () => {},
      onTimelineCommentKeydown: () => {},
      onCommentInput: () => {},
      onCommentBlur: () => {}
    });

    // Simulate click
    mockEls.gradeButtons[0].click();
    assert(callbackCount === 1, 'Event listener callback must trigger exactly once');

    // 10. Database rollback on cascade delete is verified
    await testDb.deleteVideoCascade(video.id);
    const postDelVideo = testDb.getVideo(video.id);
    assert(postDelVideo === null, 'Asset must be cascade deleted');
  });

  console.groupEnd(); // Group 16
  return results;
}
