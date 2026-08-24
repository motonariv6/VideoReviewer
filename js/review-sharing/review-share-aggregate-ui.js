// review-share-aggregate-ui.js - Rendering logic for multiple reviewers' aggregated review UI section
import { scoreToGrade } from './review-share-model.js';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Renders the aggregated shared review UI.
 *
 * @param {Object} els - Map of DOM elements
 * @param {Object} vm - Shared review view model
 * @param {Function} onTimeSeekClick - Seek callback when timeline comment timestamp is clicked
 */
export function renderSharedReviewsUI(els, vm, onTimeSeekClick) {
  if (!els || !vm) return;

  // 1. Overall summary
  if (els.sharedAverageRating) {
    els.sharedAverageRating.textContent = vm.averageRating !== null ? vm.averageRating.toFixed(1) : '-';
  }
  if (els.sharedReviewersCount) {
    els.sharedReviewersCount.textContent = `${vm.reviewCount} reviewers`;
  }
  if (els.sharedRatedCount) {
    els.sharedRatedCount.textContent = `${vm.ratedReviewCount} rated`;
  }

  // 2. Reviewers list
  if (els.sharedReviewersList) {
    els.sharedReviewersList.innerHTML = '';
    vm.reviewers.forEach(r => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.fontSize = '0.8125rem';
      row.style.padding = '4px 0';

      const leftSpan = document.createElement('span');
      leftSpan.style.display = 'flex';
      leftSpan.style.alignItems = 'center';
      leftSpan.style.gap = '6px';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = r.displayName;
      nameSpan.style.fontWeight = r.isLocal ? '600' : '400';
      leftSpan.appendChild(nameSpan);

      const badge = document.createElement('span');
      badge.className = 'reviewer-badge';
      badge.style.fontSize = '0.6875rem';
      badge.style.padding = '1px 6px';
      badge.style.borderRadius = '3px';
      if (r.isLocal) {
        badge.textContent = '自分';
        badge.style.backgroundColor = 'var(--color-primary-light, #e0e7ff)';
        badge.style.color = 'var(--color-primary, #4338ca)';
      } else {
        badge.textContent = 'Imported';
        badge.style.backgroundColor = 'var(--color-bg-secondary, #f3f4f6)';
        badge.style.color = 'var(--color-text-muted, #6b7280)';
      }
      leftSpan.appendChild(badge);
      row.appendChild(leftSpan);

      const rightSpan = document.createElement('span');
      rightSpan.style.fontWeight = '600';
      if (r.overallRating !== null) {
        const grade = scoreToGrade(r.overallRating);
        rightSpan.textContent = `${grade} (${r.overallRating})`;
      } else {
        rightSpan.textContent = '-';
        rightSpan.style.color = 'var(--color-text-dim, #9ca3af)';
      }
      row.appendChild(rightSpan);

      els.sharedReviewersList.appendChild(row);
    });
  }

  // 3. Merged Tags list
  if (els.sharedTagsList) {
    els.sharedTagsList.innerHTML = '';
    if (vm.tags.length === 0) {
      const span = document.createElement('span');
      span.style.fontSize = '0.75rem';
      span.style.color = 'var(--color-text-dim, #9ca3af)';
      span.textContent = 'タグの付与はありません';
      els.sharedTagsList.appendChild(span);
    } else {
      vm.tags.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.style.cursor = 'default';

        const label = document.createElement('span');
        label.textContent = t.tag;
        chip.appendChild(label);

        // Count suffix
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '0.6875rem';
        countSpan.style.color = 'var(--color-text-muted, #6b7280)';
        countSpan.style.marginLeft = '4px';
        countSpan.textContent = `x${t.sources.length}`;
        chip.appendChild(countSpan);

        // Tooltip displaying source reviewers
        const sourceNames = t.sources.map(s => s.reviewerName).join(', ');
        chip.title = `付与者: ${sourceNames}`;

        els.sharedTagsList.appendChild(chip);
      });
    }
  }

  // 4. Merged Timeline Comments
  if (els.sharedTimelineList) {
    els.sharedTimelineList.innerHTML = '';
    if (vm.timelineComments.length === 0) {
      const p = document.createElement('p');
      p.style.fontSize = '0.8125rem';
      p.style.color = 'var(--color-text-dim, #9ca3af)';
      p.style.textAlign = 'center';
      p.style.padding = '12px';
      p.textContent = 'タイムラインコメントはありません';
      els.sharedTimelineList.appendChild(p);
    } else {
      vm.timelineComments.forEach(c => {
        const item = document.createElement('div');
        item.className = 'timeline-note-item';
        item.style.padding = '8px';
        item.style.borderBottom = '1px solid var(--color-border)';

        const contentBox = document.createElement('div');
        contentBox.className = 'timeline-note-content-box';
        contentBox.style.marginLeft = '0'; // align left since no thumbnail image is rendered for shared

        const metaRow = document.createElement('div');
        metaRow.className = 'timeline-note-meta-row';
        metaRow.style.display = 'flex';
        metaRow.style.justifyContent = 'space-between';
        metaRow.style.alignItems = 'center';

        const leftMeta = document.createElement('div');
        leftMeta.style.display = 'flex';
        leftMeta.style.alignItems = 'center';
        leftMeta.style.gap = '8px';

        // Timestamp Seek Button
        const tsBtn = document.createElement('button');
        tsBtn.className = 'timeline-note-timestamp';
        tsBtn.title = 'この再生位置へ移動';
        tsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="width:12px;height:12px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>`;
        const tsLabelText = document.createTextNode(` ${formatTime(c.time)}`);
        tsBtn.appendChild(tsLabelText);
        tsBtn.addEventListener('click', () => {
          if (onTimeSeekClick) onTimeSeekClick(c.time);
        });
        leftMeta.appendChild(tsBtn);

        // Reviewer Name & Label
        const authorSpan = document.createElement('span');
        authorSpan.textContent = c.reviewerName;
        authorSpan.style.fontSize = '0.75rem';
        authorSpan.style.fontWeight = '600';
        authorSpan.style.color = c.isLocal ? 'var(--color-primary, #4338ca)' : 'var(--color-text, #1f2937)';
        leftMeta.appendChild(authorSpan);

        if (c.isLocal) {
          const selfBadge = document.createElement('span');
          selfBadge.textContent = '自分';
          selfBadge.style.fontSize = '0.625rem';
          selfBadge.style.backgroundColor = 'var(--color-primary-light, #e0e7ff)';
          selfBadge.style.color = 'var(--color-primary, #4338ca)';
          selfBadge.style.padding = '0px 4px';
          selfBadge.style.borderRadius = '2px';
          leftMeta.appendChild(selfBadge);
        }

        metaRow.appendChild(leftMeta);
        contentBox.appendChild(metaRow);

        const commentP = document.createElement('p');
        commentP.className = 'timeline-note-comment';
        commentP.textContent = c.comment;
        commentP.style.marginTop = '4px';
        contentBox.appendChild(commentP);

        item.appendChild(contentBox);
        els.sharedTimelineList.appendChild(item);
      });
    }
  }
}
