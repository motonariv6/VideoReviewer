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
    this.els = ui.els;
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
    this.els.viewLibrary.classList.add('hidden');
    this.els.viewEditor.classList.remove('hidden');
    this.els.btnBack.classList.remove('hidden');

    // Set header details safely
    this.els.editorTitle.textContent = video.displayTitle || video.title;
    this.els.infoFileName.textContent = video.fileName || 'フォルダ内動画';
    this.els.infoFileSize.textContent = video.fileSize ? (video.fileSize / 1024 / 1024).toFixed(1) + ' MB' : '-';
    this.els.infoDuration.textContent = this.formatTime(video.duration);

    // Reset display title edit widgets
    this.els.titleDisplayContainer.classList.remove('hidden');
    this.els.titleEditContainer.classList.add('hidden');
    this.els.displayTitleInput.value = video.displayTitle || '';

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
    this.els.commentEditor.value = review ? review.comment : '';

    // Render tags
    this.renderVideoTagsList();

    // Render timeline notes
    this.renderTimelineNotesList();

    // Render locations list
    this.renderLocationsListInEditor(video);

    // Initialize dynamic captured timestamp label
    this.state.capturedNoteTime = 0;
    this.state.capturedNoteThumb = null;
    this.els.capturedTimestampLabel.textContent = '[00:00]';
    this.els.timelineCommentField.value = '';

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
      (critId, starVal, starsGroup) => this.onStarClick(critId, starVal, starsGroup),
      (critId, starsGroup) => this.onStarClear(critId, starsGroup)
    );
  }

  /**
   * Star rating click handler
   */
  onStarClick(critId, starVal, starsGroup) {
    if (this.state.currentRatings[critId] === starVal) {
      this.state.currentRatings[critId] = 0;
    } else {
      this.state.currentRatings[critId] = starVal;
    }

    const rowStars = starsGroup.querySelectorAll('.star-elem');
    rowStars.forEach((st, idx) => {
      if (idx < (this.state.currentRatings[critId] || 0)) {
        st.classList.add('active');
      } else {
        st.classList.remove('active');
      }
    });

    this.markDirty();
    this.updateRadar();
  }

  /**
   * Star rating clear handler
   */
  onStarClear(critId, starsGroup) {
    this.state.currentRatings[critId] = 0;
    starsGroup.querySelectorAll('.star-elem').forEach(st => st.classList.remove('active'));
    this.markDirty();
    this.updateRadar();
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
    const val = this.els.tagInputField.value.trim().toLowerCase();
    if (!val) {
      this.els.tagAutocomplete.classList.add('hidden');
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
        this.els.tagInputField.value = '';
        this.els.tagAutocomplete.classList.add('hidden');
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
      const val = this.els.tagInputField.value.trim();
      if (val && this.state.currentVideoId) {
        try {
          const existingTags = this.db.getVideoTags(this.state.currentVideoId);
          if (existingTags.some(t => t.name.toLowerCase() === val.toLowerCase())) {
            this.showToast('このタグは既に追加されています', 'error');
            this.els.tagInputField.value = '';
            this.els.tagAutocomplete.classList.add('hidden');
            return;
          }

          await this.db.addTagToVideo(this.state.currentVideoId, val);
          this.els.tagInputField.value = '';
          this.els.tagAutocomplete.classList.add('hidden');
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
    this.els.capturedTimestampLabel.textContent = `[${this.formatTime(currentSecs)}]`;

    this.els.timelineCommentField.focus();

    this.state.capturedNoteThumb = await this.captureFrame();
  }

  /**
   * Add timeline note to DB
   */
  async addTimelineNote() {
    const comment = this.els.timelineCommentField.value.trim();
    if (!this.state.currentVideoId) return;

    const label = this.formatTime(this.state.capturedNoteTime);

    try {
      await this.db.addTimelineNote(this.state.currentVideoId, {
        timestampSeconds: this.state.capturedNoteTime,
        timestampLabel: label,
        comment: comment,
        thumbnailBlob: this.state.capturedNoteThumb
      });

      this.els.timelineCommentField.value = '';
      this.state.capturedNoteThumb = null;
      this.state.capturedNoteTime = 0;
      this.els.capturedTimestampLabel.textContent = '[00:00]';

      this.renderTimelineNotesList();
      this.showToast('タイムラインメモを追加しました');
    } catch (err) {
      this.showToast(`保存できませんでした: ${err.message}`, 'error');
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
        comment: this.els.commentEditor.value,
        ratings: this.state.currentRatings
      });

      this.clearDirty();

      if (!isAutosave) {
        this.showToast('評価内容を保存しました');
      } else {
        this.els.autosaveIndicator.textContent = '自動保存しました';
        this.els.autosaveIndicator.style.color = 'var(--color-success)';
        setTimeout(() => {
          if (!this.state.isDirty && this.state.currentView === 'editor') {
            this.els.autosaveIndicator.textContent = '自動保存: 有効';
            this.els.autosaveIndicator.style.color = 'var(--color-text-dim)';
          }
        }, 1500);
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
    let titleVal = this.els.displayTitleInput.value.replace(/<\/?[^>]+(>|$)/g, "").trim();

    await this.db.updateVideo(video.id, { displayTitle: titleVal || null });

    // Update UI headers
    this.els.editorTitle.textContent = titleVal || video.title;
    this.els.titleDisplayContainer.classList.remove('hidden');
    this.els.titleEditContainer.classList.add('hidden');

    this.showToast('表示タイトルを更新しました。');

    this.renderLibrary();
  }

  /**
   * Change video genre and reload ratings criteria panel
   */
  async changeGenre() {
    const videoId = this.state.currentVideoId;
    if (!videoId) return;

    const genreId = this.els.videoGenreSelect.value;
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
