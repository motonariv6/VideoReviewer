import { bgHashState } from './hash-verification-controller.js';

let bgHashCloseTimeout = null;
let bgHashLastUpdateTime = 0;
let bgHashLastPercent = -1;

export function clearCloseTimeout() {
  if (bgHashCloseTimeout) {
    clearTimeout(bgHashCloseTimeout);
    bgHashCloseTimeout = null;
  }
}

export function updateBackgroundHashingProgress(force = false) {
  const total = bgHashState.targetKeys.size;

  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const id of bgHashState.targetKeys) {
    if (bgHashState.completedKeys.has(id)) {
      completedCount++;
    } else if (bgHashState.failedKeys.has(id)) {
      failedCount++;
    } else if (bgHashState.skippedKeys.has(id)) {
      skippedCount++;
    }
  }

  const current = completedCount + failedCount + skippedCount;

  if (total === 0) {
    clearCloseTimeout();
    updateBackgroundHashingUI(0, 0);
    return;
  }

  if (current === total) {
    if (!bgHashCloseTimeout) {
      bgHashCloseTimeout = setTimeout(() => {
        bgHashCloseTimeout = null;
        updateBackgroundHashingUI(0, 0);
      }, 3000);
    }
  } else {
    clearCloseTimeout();
  }

  triggerUIUpdate(current, total, force);
}

function triggerUIUpdate(completed, total, force) {
  const now = Date.now();
  const percent = bgHashState.activePercent;
  const percentChanged = percent !== bgHashLastPercent;
  const timeElapsed = now - bgHashLastUpdateTime > 100;

  if (force || percentChanged || timeElapsed || completed === total) {
    bgHashLastUpdateTime = now;
    bgHashLastPercent = percent;
    updateBackgroundHashingUI(completed, total);
  }
}

export function updateBackgroundHashingUI(current, total) {
  let indicator = document.getElementById('bg-hash-indicator');
  
  if (bgHashState.panelClosed) {
    if (indicator) indicator.classList.add('hidden');
    return;
  }

  if (total === 0 || (current >= total && !bgHashCloseTimeout)) {
    if (indicator) indicator.classList.add('hidden');
    return;
  }

  if (!document.getElementById('bg-hash-styles')) {
    const style = document.createElement('style');
    style.id = 'bg-hash-styles';
    style.textContent = `
      @keyframes bg-hash-slide {
        0% { left: -30%; }
        100% { left: 100%; }
      }
      .bg-hash-indeterminate {
        position: relative;
        overflow: hidden;
        background-color: var(--color-border, #374151) !important;
      }
      .bg-hash-indeterminate::after {
        content: '';
        position: absolute;
        top: 0; left: -30%; width: 30%; height: 100%;
        background: linear-gradient(90deg, transparent, var(--color-primary, #6366f1), transparent);
        animation: bg-hash-slide 1.2s infinite linear;
      }
      #bg-hash-indicator {
        position: fixed;
        top: 76px;
        right: 16px;
        padding: 12px 16px;
        background-color: var(--color-bg-card, #1f2937);
        color: var(--color-text, #f3f4f6);
        border-radius: var(--radius-sm, 6px);
        box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.15));
        border: 1px solid var(--color-border, #374151);
        font-size: 0.75rem;
        font-weight: 600;
        z-index: 90;
        transition: opacity 0.3s ease;
        width: 260px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        pointer-events: auto;
      }
      @media (max-width: 640px) {
        #bg-hash-indicator {
          left: 16px;
          right: 16px;
          width: auto;
          max-width: calc(100vw - 32px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'bg-hash-indicator';
    document.body.appendChild(indicator);
  }

  indicator.classList.remove('hidden');

  let headerRow = indicator.querySelector('.bg-hash-header-row');
  if (!headerRow) {
    headerRow = document.createElement('div');
    headerRow.className = 'bg-hash-header-row';
    headerRow.style.display = 'flex';
    headerRow.style.justify = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.width = '100%';
    headerRow.style.gap = '8px';
    indicator.appendChild(headerRow);
  }

  let titleEl = headerRow.querySelector('.bg-hash-title');
  if (!titleEl) {
    titleEl = document.createElement('div');
    titleEl.className = 'bg-hash-title';
    titleEl.style.fontSize = '0.8125rem';
    titleEl.style.color = 'var(--color-text, #f3f4f6)';
    titleEl.style.flex = '1';
    titleEl.style.whiteSpace = 'nowrap';
    titleEl.style.overflow = 'hidden';
    titleEl.style.textOverflow = 'ellipsis';
    headerRow.appendChild(titleEl);
  }

  let actionsEl = headerRow.querySelector('.bg-hash-actions');
  if (!actionsEl) {
    actionsEl = document.createElement('div');
    actionsEl.className = 'bg-hash-actions';
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '8px';
    actionsEl.style.alignItems = 'center';
    headerRow.appendChild(actionsEl);
  }

  let minBtn = actionsEl.querySelector('.bg-hash-btn-min');
  if (!minBtn) {
    minBtn = document.createElement('button');
    minBtn.className = 'bg-hash-btn-min';
    minBtn.style.background = 'none';
    minBtn.style.border = 'none';
    minBtn.style.color = 'var(--color-text-muted, #9ca3af)';
    minBtn.style.cursor = 'pointer';
    minBtn.style.padding = '2px';
    minBtn.style.fontSize = '0.75rem';
    minBtn.style.lineHeight = '1';
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bgHashState.panelMinimized = !bgHashState.panelMinimized;
      updateBackgroundHashingProgress(true);
    });
    actionsEl.appendChild(minBtn);
  }

  let closeBtn = actionsEl.querySelector('.bg-hash-btn-close');
  if (!closeBtn) {
    closeBtn = document.createElement('button');
    closeBtn.className = 'bg-hash-btn-close';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.color = 'var(--color-text-muted, #9ca3af)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '2px';
    closeBtn.style.fontSize = '0.75rem';
    closeBtn.style.lineHeight = '1';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bgHashState.panelClosed = true;
      indicator.classList.add('hidden');
    });
    actionsEl.appendChild(closeBtn);
  }

  let fileEl = indicator.querySelector('.bg-hash-file');
  if (!fileEl) {
    fileEl = document.createElement('div');
    fileEl.className = 'bg-hash-file';
    fileEl.style.fontSize = '0.75rem';
    fileEl.style.color = 'var(--color-text-muted, #9ca3af)';
    fileEl.style.whiteSpace = 'nowrap';
    fileEl.style.overflow = 'hidden';
    fileEl.style.textOverflow = 'ellipsis';
    indicator.appendChild(fileEl);
  }

  let progressContainer = indicator.querySelector('.bg-hash-progress-container');
  if (!progressContainer) {
    progressContainer = document.createElement('div');
    progressContainer.className = 'bg-hash-progress-container';
    Object.assign(progressContainer.style, {
      width: '100%',
      backgroundColor: 'var(--color-border, #374151)',
      height: '6px',
      borderRadius: '3px',
      overflow: 'hidden',
      position: 'relative'
    });
    const fillEl = document.createElement('div');
    fillEl.className = 'bg-hash-progress-fill';
    Object.assign(fillEl.style, {
      height: '100%',
      backgroundColor: 'var(--color-primary, #6366f1)',
      width: '0%',
      transition: 'width 0.1s ease'
    });
    progressContainer.appendChild(fillEl);
    indicator.appendChild(progressContainer);
  }

  const fillEl = progressContainer.querySelector('.bg-hash-progress-fill');

  if (bgHashState.panelMinimized) {
    titleEl.textContent = `ハッシュ検証 ${current} / ${total}`;
    minBtn.textContent = '＋';
    fileEl.style.display = 'none';
    progressContainer.style.display = 'none';
    indicator.style.gap = '0px';
    indicator.style.padding = '8px 12px';
  } else {
    let headerText = `フルハッシュ検証中 ${current} / ${total}`;
    const extraStats = [];
    let failedCount = 0;
    let skippedCount = 0;
    for (const id of bgHashState.targetKeys) {
      if (bgHashState.failedKeys.has(id)) failedCount++;
      else if (bgHashState.skippedKeys.has(id)) skippedCount++;
    }

    if (failedCount > 0) extraStats.push(`失敗: ${failedCount}件`);
    if (skippedCount > 0) extraStats.push(`スキップ: ${skippedCount}件`);
    if (extraStats.length > 0) headerText += ` (${extraStats.join(', ')})`;

    titleEl.textContent = headerText;
    minBtn.textContent = '－';
    indicator.style.gap = '6px';
    indicator.style.padding = '12px 16px';

    const clipName = (name) => {
      if (!name) return '';
      if (name.length > 25) {
        return name.slice(0, 12) + '...' + name.slice(-10);
      }
      return name;
    };

    if (bgHashState.activeId) {
      const pct = bgHashState.activePercent;
      fileEl.textContent = `${clipName(bgHashState.activeName)} (${pct === null ? '検証中' : pct + '%'})`;
      fileEl.style.display = '';
      progressContainer.style.display = '';

      if (pct === null) {
        fillEl.className = 'bg-hash-progress-fill bg-hash-indeterminate';
        fillEl.style.width = '100%';
      } else {
        fillEl.className = 'bg-hash-progress-fill';
        fillEl.style.width = `${pct}%`;
      }
    } else {
      fileEl.style.display = 'none';
      progressContainer.style.display = 'none';
    }
  }
}
