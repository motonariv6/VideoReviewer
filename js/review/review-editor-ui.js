// review-editor-ui.js - View and rendering logic for Video Review Editor workspace

export class ReviewEditorUI {
  /**
   * @param {Object} options
   * @param {Object} options.els - DOM elements reference map
   */
  constructor({ els }) {
    this.els = els;
  }

  /**
   * Render individual criteria star ratings list
   */
  renderStarCriteriaPanel(activeCriteria, currentRatings, onStarClick, onStarClear) {
    this.els.criteriaPanel.innerHTML = '';

    if (activeCriteria.length === 0) {
      const p = document.createElement('p');
      p.style.fontSize = '0.8125rem';
      p.style.color = 'var(--color-text-dim)';
      p.style.textAlign = 'center';
      p.style.padding = '12px';
      p.textContent = '有効な評価項目が登録されていません。「評価項目設定」から項目を追加してください。';
      this.els.criteriaPanel.appendChild(p);
      return;
    }

    activeCriteria.forEach(crit => {
      const currentScore = currentRatings[crit.id] || 0;

      const row = document.createElement('div');
      row.className = 'star-rating-row';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'star-rating-label';
      if (crit.isActive === false) {
        labelSpan.textContent = crit.name + ' (非表示)';
        labelSpan.style.color = 'var(--color-text-muted)';
      } else {
        labelSpan.textContent = crit.name;
      }
      row.appendChild(labelSpan);

      const interactiveDiv = document.createElement('div');
      interactiveDiv.className = 'stars-interactive-container';

      const starsGroup = document.createElement('div');
      starsGroup.className = 'stars-group';
      starsGroup.setAttribute('data-criterion-id', crit.id);

      for (let s = 1; s <= 5; s++) {
        const starSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        starSvg.setAttribute('class', `star-elem ${s <= currentScore ? 'active' : ''}`);
        starSvg.setAttribute('data-star', s.toString());
        starSvg.setAttribute('fill', 'currentColor');
        starSvg.setAttribute('viewBox', '0 0 20 20');
        starSvg.innerHTML = `<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />`;

        starSvg.addEventListener('click', () => {
          onStarClick(crit.id, s, starsGroup);
        });
        starsGroup.appendChild(starSvg);
      }
      interactiveDiv.appendChild(starsGroup);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'star-clear-btn';
      clearBtn.title = '評価をクリア';
      clearBtn.textContent = 'クリア';
      clearBtn.addEventListener('click', () => {
        onStarClear(crit.id, starsGroup);
      });
      interactiveDiv.appendChild(clearBtn);
      row.appendChild(interactiveDiv);

      this.els.criteriaPanel.appendChild(row);
    });
  }

  /**
   * Render tag chips
   */
  renderVideoTagsList(tags, onRemoveClick) {
    this.els.tagsChipsList.innerHTML = '';

    if (tags.length === 0) {
      const span = document.createElement('span');
      span.style.fontSize = '0.75rem';
      span.style.color = 'var(--color-text-dim)';
      span.textContent = 'タグ登録がありません';
      this.els.tagsChipsList.appendChild(span);
    } else {
      tags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';

        const label = document.createElement('span');
        label.textContent = t.name;
        chip.appendChild(label);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'tag-chip-remove';
        removeBtn.title = 'タグを削除';
        removeBtn.innerHTML = `<svg fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>`;
        removeBtn.addEventListener('click', () => {
          onRemoveClick(t.id);
        });
        chip.appendChild(removeBtn);

        this.els.tagsChipsList.appendChild(chip);
      });
    }
  }

  /**
   * Render tags autocomplete options list
   */
  renderTagAutocomplete(matches, onMatchClick) {
    if (matches.length === 0) {
      this.els.tagAutocomplete.classList.add('hidden');
      return;
    }

    this.els.tagAutocomplete.innerHTML = '';
    matches.forEach(t => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = t.name;
      item.addEventListener('click', () => {
        onMatchClick(t.name);
      });
      this.els.tagAutocomplete.appendChild(item);
    });
    this.els.tagAutocomplete.classList.remove('hidden');
  }

  /**
   * Render timeline notes list
   */
  renderTimelineNotesList(notes, onTimeSeekClick, onDeleteClick, loadImageToElement, clearImageBlobUrls) {
    if (clearImageBlobUrls) {
      clearImageBlobUrls();
    }

    this.els.timelineNotesList.innerHTML = '';

    if (notes.length === 0) {
      const p = document.createElement('p');
      p.style.fontSize = '0.8125rem';
      p.style.color = 'var(--color-text-dim)';
      p.style.textAlign = 'center';
      p.style.padding = '20px';
      p.textContent = 'タイムライン引用メモはまだありません。';
      this.els.timelineNotesList.appendChild(p);
      return;
    }

    notes.forEach(note => {
      const item = document.createElement('div');
      item.className = 'timeline-note-item';

      // Thumbnail container
      const thumbDiv = document.createElement('div');
      thumbDiv.className = 'timeline-note-thumb';

      const img = document.createElement('img');
      img.alt = 'Scene capture';
      if (loadImageToElement) {
        loadImageToElement(img, note.thumbnailId, note.thumbnailUrl);
      }
      thumbDiv.appendChild(img);

      const fallbackIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      fallbackIcon.setAttribute('class', 'timeline-note-thumb-icon');
      fallbackIcon.setAttribute('fill', 'none');
      fallbackIcon.setAttribute('viewBox', '0 0 24 24');
      fallbackIcon.setAttribute('stroke', 'currentColor');
      fallbackIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;`;
      thumbDiv.appendChild(fallbackIcon);

      // Content container
      const contentBox = document.createElement('div');
      contentBox.className = 'timeline-note-content-box';

      const metaRow = document.createElement('div');
      metaRow.className = 'timeline-note-meta-row';

      const tsBtn = document.createElement('button');
      tsBtn.className = 'timeline-note-timestamp';
      tsBtn.title = 'この再生位置へ移動';
      tsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>`;
      const tsLabelText = document.createTextNode(` ${note.timestampLabel}`);
      tsBtn.appendChild(tsLabelText);
      tsBtn.addEventListener('click', () => {
        onTimeSeekClick(note.timestampSeconds);
      });
      metaRow.appendChild(tsBtn);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'timeline-note-actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'timeline-note-action-btn delete';
      delBtn.title = 'メモを削除';
      delBtn.innerHTML = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>`;
      delBtn.addEventListener('click', () => {
        onDeleteClick(note.id);
      });
      actionsDiv.appendChild(delBtn);
      metaRow.appendChild(actionsDiv);

      const commentP = document.createElement('p');
      commentP.className = 'timeline-note-comment';
      if (note.comment) {
        commentP.textContent = note.comment;
      } else {
        const italicSpan = document.createElement('span');
        italicSpan.style.color = 'var(--color-text-dim)';
        italicSpan.style.fontStyle = 'italic';
        italicSpan.textContent = 'コメント未入力';
        commentP.appendChild(italicSpan);
      }

      contentBox.appendChild(metaRow);
      contentBox.appendChild(commentP);

      item.appendChild(thumbDiv);
      item.appendChild(contentBox);
      this.els.timelineNotesList.appendChild(item);
    });
  }

  /**
   * Render file locations list inside editor panel
   */
  renderLocationsListInEditor(locations, onDeleteLocationClick) {
    this.els.infoLocationsContainer.style.display = 'block';
    this.els.infoLocationsList.innerHTML = '';
    if (!locations || locations.length === 0) return;

    locations.forEach(loc => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.fontSize = '0.75rem';
      row.style.padding = '4px 8px';
      row.style.backgroundColor = 'rgba(255,255,255,0.05)';
      row.style.borderRadius = '4px';

      const pathSpan = document.createElement('span');
      pathSpan.style.wordBreak = 'break-all';
      pathSpan.textContent = `📁 ${loc.folderName} / ${loc.relativePath}`;
      if (loc.verificationStatus === 'provisional') {
        pathSpan.textContent += ' (ハッシュ検証前)';
        pathSpan.style.color = 'var(--color-warning, #f59e0b)';
      }
      row.appendChild(pathSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-icon';
      delBtn.title = 'ロケーション登録を削除 (評価データは残ります)';
      delBtn.style.color = 'var(--color-text-muted)';
      delBtn.style.cursor = 'pointer';
      delBtn.style.padding = '2px';
      delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>`;

      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDeleteLocationClick(loc);
      });

      row.appendChild(delBtn);
      this.els.infoLocationsList.appendChild(row);
    });
  }

  /**
   * Populate genre dropdown options
   */
  populateGenreSelect(allGenres, currentGenreId) {
    this.els.videoGenreSelect.innerHTML = '';
    allGenres.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.isActive ? g.name : `${g.name} (無効)`;
      this.els.videoGenreSelect.appendChild(opt);
    });
    this.els.videoGenreSelect.value = currentGenreId || 'genre-default';
  }

  /**
   * Toggle provisional warning banner visibility
   */
  updateProvisionalWarningBanner(isProvisional) {
    if (isProvisional) {
      this.els.provisionalWarningBanner.classList.remove('hidden');
    } else {
      this.els.provisionalWarningBanner.classList.add('hidden');
    }
  }

  /**
   * Toggle overall grade active button states
   */
  updateOverallGradeUI(grade) {
    this.els.gradeButtons.forEach(btn => btn.classList.remove('active'));
    if (grade) {
      const activeBtn = document.querySelector(`.grade-btn[data-grade="${grade}"]`);
      if (activeBtn) activeBtn.classList.add('active');
    }
  }
}
