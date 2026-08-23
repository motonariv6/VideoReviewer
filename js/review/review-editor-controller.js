// review-editor-controller.js - Business logic and use case controller for Video Review Editor workspace

export class ReviewEditorController {
  constructor({
    db,
    ui,
    state,
    radar,
    showToast,
    markDirty,
    clearDirty,
    getCurrentTime,
    seekTo,
    captureFrame,
    loadImageToElement,
    clearImageBlobUrls,
    formatTime,
    renderLibrary,
    handleBackToLibrary,
    deleteFileLocationAction,
    handleLocationsRemoved,
    updateBackgroundHashingProgress,
    loadVideoMediaSource,
    confirm
  }) {
    this.db = db;
    this.ui = ui;
    this.state = state;
    this.radar = radar;
    this.showToast = showToast;
    this.markDirty = markDirty;
    this.clearDirty = clearDirty;
    this.getCurrentTime = getCurrentTime;
    this.seekTo = seekTo;
    this.captureFrame = captureFrame;
    this.loadImageToElement = loadImageToElement;
    this.clearImageBlobUrls = clearImageBlobUrls;
    this.formatTime = formatTime;
    this.renderLibrary = renderLibrary;
    this.handleBackToLibrary = handleBackToLibrary;
    this.deleteFileLocationAction = deleteFileLocationAction;
    this.handleLocationsRemoved = handleLocationsRemoved;
    this.updateBackgroundHashingProgress = updateBackgroundHashingProgress;
    this.loadVideoMediaSource = loadVideoMediaSource;
    this.confirm = confirm || window.confirm.bind(window);
  }

  /**
   * Transition to review editor workspace screen and load all video review states
   * @param {string} videoId
   */
  async switchScreenToEditor(videoId) {
    const video = this.db.getVideo(videoId);
    if (!video) return;

    this.state.currentVideoId = videoId;
    this.state.currentView = 'editor';

    // UI screen transit & populate metadata
    this.ui.showEditor(video, this.formatTime(video.duration));

    // Populate and select Video Genre select dropdown options
    const allGenres = this.db.getGenres();
    this.ui.populateGenreSelect(allGenres, video.genreId);

    // Load ratings content
    const review = this.db.getReviewForVideo(videoId);

    // Load overall grade button state
    this.state.currentOverallGrade = review ? review.overallGrade : null;
    this.ui.updateOverallGradeUI(this.state.currentOverallGrade);

    // Load individual ratings stars map
    const scores = review ? this.db.getCriterionRatingsForReview(review.id) : [];
    this.state.currentRatings = {};
    scores.forEach(s => {
      this.state.currentRatings[s.criterionId] = s.score;
    });

    // Render individual star lists
    this.renderStarCriteriaPanel();

    // Load comment
    this.ui.setCommentValue(review ? review.comment : '');

    // Render tags
    this.renderVideoTagsList();

    // Render timeline notes
    this.renderTimelineNotesList();

    // Render locations list
    this.renderLocationsListInEditor(video);

    // Initialize dynamic captured timestamp label
    this.state.capturedNoteTime = 0;
    this.state.capturedNoteThumb = null;
    this.ui.clearTimelineInput();

    // Disable or enable fields based on whether the asset itself is provisional
    const isProvisional = video.identityStatus === 'provisional';
    this.ui.updateProvisionalWarningBanner(isProvisional);

    // Draw chart
    this.updateRadar();

    // Load media source in player
    this.loadVideoMediaSource(video);

    this.clearDirty();
  }

  /**
   * Render active criteria star list panel
   */
  renderStarCriteriaPanel() {
    const activeCriteria = this.db.getCriteriaForVideoReview(this.state.currentVideoId);
    this.ui.renderStarCriteriaPanel(
      activeCriteria,
      this.state.currentRatings,
      (critId, starVal) => this.onStarClick(critId, starVal),
      (critId) => this.onStarClear(critId)
    );
  }

  /**
   * Star rating click handler
   */
  onStarClick(critId, starVal) {
    if (this.state.currentRatings[critId] === starVal) {
      this.state.currentRatings[critId] = 0;
    } else {
      this.state.currentRatings[critId] = starVal;
    }

    this.ui.updateCriterionStars(critId, this.state.currentRatings[critId]);

    this.markDirty();
    this.updateRadar();
  }

  /**
   * Star rating clear handler
   */
  onStarClear(critId) {
    this.state.currentRatings[critId] = 0;
    this.ui.updateCriterionStars(critId, 0);
    this.markDirty();
    this.updateRadar();
  }

  /**
   * Overall Grade click handler
   */
  handleGradeClick(grade) {
    this.state.currentOverallGrade = grade;
    this.markDirty();
    this.updateRadar();
    this.ui.updateOverallGradeUI(grade);
  }

  /**
   * Clear Overall Grade click handler
   */
  handleClearGradeClick() {
    this.state.currentOverallGrade = null;
    this.markDirty();
    this.updateRadar();
    this.ui.updateOverallGradeUI(null);
  }

  /**
   * Trigger Radar chart SVG update
   */
  updateRadar() {
    if (!this.radar) return;
    const criteria = this.db.getCriteriaForVideoReview(this.state.currentVideoId);
    this.radar.render(criteria, this.state.currentRatings);
  }

  /**
   * Render tag chips in workspace
   */
  renderVideoTagsList() {
    if (!this.state.currentVideoId) return;
    const tags = this.db.getVideoTags(this.state.currentVideoId);
    this.ui.renderVideoTagsList(tags, (tagId) => this.onRemoveTag(tagId));
  }

  /**
   * Tag chip deletion handler
   */
  async onRemoveTag(tagId) {
    try {
      await this.db.removeTagFromVideo(this.state.currentVideoId, tagId);
      this.renderVideoTagsList();
    } catch (err) {
      this.showToast(`タグの削除に失敗しました: ${err.message}`, 'error');
    }
  }

  /**
   * Auto-complete tags matching user text input
   */
  handleTagInputFieldAutocomplete() {
    const val = this.ui.getTagInputValue().trim().toLowerCase();
    if (!val) {
      this.ui.hideTagAutocomplete();
      return;
    }

    const matches = this.db.getTags()
      .filter(t => t.normalizedName.includes(val))
      .slice(0, 5);

    this.ui.renderTagAutocomplete(matches, (tagName) => this.onAddAutocompleteTag(tagName));
  }

  /**
   * Tag dropdown match click handler
   */
  async onAddAutocompleteTag(tagName) {
    if (this.state.currentVideoId) {
      try {
        await this.db.addTagToVideo(this.state.currentVideoId, tagName);
        this.ui.clearTagInput();
        this.ui.hideTagAutocomplete();
        this.renderVideoTagsList();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    }
  }

  /**
   * Keydown handler for manual tag input submission
   */
  async handleTagInputKeydown(e, isTagInputComposing) {
    if (e.isComposing || isTagInputComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = this.ui.getTagInputValue().trim();
      if (val && this.state.currentVideoId) {
        try {
          const existingTags = this.db.getVideoTags(this.state.currentVideoId);
          if (existingTags.some(t => t.name.toLowerCase() === val.toLowerCase())) {
            this.showToast('このタグは既に追加されています', 'error');
            this.ui.clearTagInput();
            this.ui.hideTagAutocomplete();
            return;
          }

          await this.db.addTagToVideo(this.state.currentVideoId, val);
          this.ui.clearTagInput();
          this.ui.hideTagAutocomplete();
          this.renderVideoTagsList();
        } catch (err) {
          this.showToast(err.message, 'error');
        }
      }
    }
  }

  /**
   * Render timeline note cards list
   */
  renderTimelineNotesList() {
    if (!this.state.currentVideoId) return;
    const notes = this.db.getTimelineNotes(this.state.currentVideoId);
    this.ui.renderTimelineNotesList(
      notes,
      (timestampSeconds) => this.seekTo(timestampSeconds),
      (noteId) => this.onDeleteTimelineNote(noteId),
      this.loadImageToElement,
      this.clearImageBlobUrls
    );
  }

  /**
   * Delete timeline note action
   */
  async onDeleteTimelineNote(noteId) {
    if (this.confirm('タイムラインメモを削除しますか？')) {
      try {
        await this.db.deleteTimelineNote(noteId);
        this.renderTimelineNotesList();
        this.showToast('メモを削除しました');
      } catch (err) {
        this.showToast(`削除に失敗しました: ${err.message}`, 'error');
      }
    }
  }

  /**
   * Snatch current player time frame and metadata
   */
  async captureTimelineTimestamp() {
    if (!this.state.currentVideoId) return;

    const currentSecs = this.getCurrentTime();
    this.state.capturedNoteTime = currentSecs;
    this.ui.setCapturedTimestamp(this.formatTime(currentSecs));

    this.ui.focusTimelineComment();

    this.state.capturedNoteThumb = await this.captureFrame();
  }

  /**
   * Add timeline note to DB
   */
  async addTimelineNote() {
    const comment = this.ui.getTimelineCommentValue();
    if (!this.state.currentVideoId) return;

    const label = this.formatTime(this.state.capturedNoteTime);

    try {
      await this.db.addTimelineNote(this.state.currentVideoId, {
        timestampSeconds: this.state.capturedNoteTime,
        timestampLabel: label,
        comment: comment,
        thumbnailBlob: this.state.capturedNoteThumb
      });

      this.ui.clearTimelineInput();
      this.state.capturedNoteThumb = null;
      this.state.capturedNoteTime = 0;

      this.renderTimelineNotesList();
      this.showToast('タイムラインメモを追加しました');
    } catch (err) {
      this.showToast(`保存できませんでした: ${err.message}`, 'error');
    }
  }

  /**
   * Keydown handler for timeline comment submission
   */
  handleTimelineCommentKeydown(e, isTimelineCommentComposing) {
    if (e.isComposing || isTimelineCommentComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.addTimelineNote();
    }
  }

  /**
   * Save entire ratings and comment review form to database
   * @param {boolean} isAutosave - Set true for background periodical auto-saves
   */
  async saveReviewForm(isAutosave = false) {
    if (!this.state.currentVideoId) return;

    try {
      await this.db.saveReview(this.state.currentVideoId, {
        overallGrade: this.state.currentOverallGrade,
        comment: this.ui.getCommentValue(),
        ratings: this.state.currentRatings
      });

      this.clearDirty();

      if (!isAutosave) {
        this.showToast('評価内容を保存しました');
      } else {
        this.ui.showAutosaveSuccess(this.state.isDirty, this.state.currentView);
      }
    } catch (err) {
      this.showToast(`保存できませんでした: ${err.message}`, 'error');
    }
  }

  /**
   * Render file locations list
   */
  renderLocationsListInEditor(video) {
    const locsResolved = video.locations.map(loc => {
      const source = this.db.getDirectorySource(loc.directoryId);
      const folderName = source ? source.name : 'フォルダ不明';
      return {
        id: loc.id,
        relativePath: loc.relativePath,
        verificationStatus: loc.verificationStatus,
        folderName
      };
    });

    this.ui.renderLocationsListInEditor(locsResolved, (loc) => this.onDeleteLocation(loc, video));
  }

  /**
   * Location deletion handler within editor panel
   */
  async onDeleteLocation(loc, video) {
    await this.deleteFileLocationAction({
      db: this.db,
      locId: loc.id,
      videoId: video.id,
      relativePath: loc.relativePath,
      showToast: this.showToast,
      handleBackToLibrary: this.handleBackToLibrary,
      renderLocationsListInEditor: (v) => this.renderLocationsListInEditor(v),
      onLocationsRemoved: (locIds) => {
        this.handleLocationsRemoved(locIds, this.updateBackgroundHashingProgress);
      },
      confirm: this.confirm
    });
  }

  /**
   * Save Display Title edit form and redraw title header safely
   */
  async saveDisplayTitle() {
    const video = this.db.getVideo(this.state.currentVideoId);
    if (!video) return;

    // Sanitize input: strip HTML tags and trim
    let titleVal = this.ui.getDisplayTitleInput().replace(/<\/?[^>]+(>|$)/g, "").trim();

    await this.db.updateVideo(video.id, { displayTitle: titleVal || null });

    // Update UI headers
    this.ui.finishDisplayTitleEdit(titleVal || video.title);

    this.showToast('表示タイトルを更新しました。');

    this.renderLibrary();
  }

  /**
   * Change video genre and reload ratings criteria panel
   */
  async changeGenre() {
    const videoId = this.state.currentVideoId;
    if (!videoId) return;

    const genreId = this.ui.getSelectedGenreId();
    await this.db.updateVideo(videoId, { genreId });

    // Reload ratings workspace
    const review = this.db.getReviewForVideo(videoId);

    // Load individual ratings stars map
    const scores = review ? this.db.getCriterionRatingsForReview(review.id) : [];
    this.state.currentRatings = {};
    scores.forEach(s => {
      this.state.currentRatings[s.criterionId] = s.score;
    });

    this.renderStarCriteriaPanel();
    this.updateRadar();
    this.markDirty();
    this.showToast('動画のジャンルを切り替えました。');
  }
}
