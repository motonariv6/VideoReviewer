import { t, translateBuiltInField } from './i18n.js';

/**
 * Custom SVG Radar Chart component.
 * Standard mathematical formula:
 * Angle (theta) = -Math.PI / 2 + (2 * Math.PI * i) / N
 * Coordinates = (cx + r * cos(theta), cy + r * sin(theta))
 */

export class RadarChart {
  /**
   * @param {HTMLElement} containerElement 
   */
  constructor(containerElement) {
    this.container = containerElement;
    this.width = 440; // Increased width for safe label margins inside viewBox
    this.height = 440; // Increased height
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.maxRadius = 100; // Radius of outer ring
  }

  /**
   * Render the radar chart
   * @param {Array} criteria - Array of active criteria {id, name}
   * @param {Object} ratings - Current ratings map { criterionId: score (1-5) }
   */
  render(criteria, ratings = {}) {
    this.container.innerHTML = '';

    if (!criteria || criteria.length < 3) {
      this.renderPlaceholder(t('radar.placeholderNeed3Criteria'));
      return;
    }

    const N = criteria.length;
    const angles = [];
    for (let i = 0; i < N; i++) {
      angles.push(-Math.PI / 2 + (2 * Math.PI * i) / N);
    }

    // Create SVG element
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.classList.add('radar-svg');

    // Add definitions for gradients and filters (glow effect)
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="var(--color-primary-glow, rgba(99, 102, 241, 0.4))" />
        <stop offset="100%" stop-color="rgba(99, 102, 241, 0)" />
      </radialGradient>
      <linearGradient id="polyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--color-primary, #6366f1)" stop-opacity="0.75" />
        <stop offset="100%" stop-color="var(--color-secondary, #a855f7)" stop-opacity="0.75" />
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="var(--color-primary, #6366f1)" flood-opacity="0.4" />
      </filter>
    `;
    svg.appendChild(defs);

    // 1. Concentric Background Polygons (Grid Rings for Level 1 to 5)
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'radar-grid');
    
    for (let level = 1; level <= 5; level++) {
      const r = this.maxRadius * (level / 5);
      const points = [];
      
      for (let i = 0; i < N; i++) {
        const x = this.cx + r * Math.cos(angles[i]);
        const y = this.cy + r * Math.sin(angles[i]);
        points.push(`${x},${y}`);
      }

      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points.join(' '));
      polygon.setAttribute('fill', 'none');
      polygon.setAttribute('stroke', 'var(--color-grid-line, rgba(255, 255, 255, 0.08))');
      polygon.setAttribute('stroke-width', '1');
      if (level === 5) {
        polygon.setAttribute('stroke', 'var(--color-grid-outer, rgba(255, 255, 255, 0.2))');
      }
      gridGroup.appendChild(polygon);

      // Level numbers label (on the vertical top axis)
      const numLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numLabel.setAttribute('x', this.cx + 4);
      numLabel.setAttribute('y', this.cy - r + 3);
      numLabel.setAttribute('fill', 'rgba(255, 255, 255, 0.3)');
      numLabel.setAttribute('font-size', '9px');
      numLabel.textContent = level;
      gridGroup.appendChild(numLabel);
    }
    svg.appendChild(gridGroup);

    // 2. Axis lines radiating from center
    const axesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    axesGroup.setAttribute('class', 'radar-axes');
    
    for (let i = 0; i < N; i++) {
      const x = this.cx + this.maxRadius * Math.cos(angles[i]);
      const y = this.cy + this.maxRadius * Math.sin(angles[i]);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', this.cx);
      line.setAttribute('y1', this.cy);
      line.setAttribute('x2', x);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', 'var(--color-grid-line, rgba(255, 255, 255, 0.12))');
      line.setAttribute('stroke-width', '1');
      axesGroup.appendChild(line);
    }
    svg.appendChild(axesGroup);

    // 3. Data Polygon (Star ratings score layout)
    const dataPoints = [];
    const ratingPointsArray = [];
    
    for (let i = 0; i < N; i++) {
      const crit = criteria[i];
      const val = ratings[crit.id] || 0;
      const r = this.maxRadius * (val / 5);
      const x = this.cx + r * Math.cos(angles[i]);
      const y = this.cy + r * Math.sin(angles[i]);
      dataPoints.push(`${x},${y}`);
      ratingPointsArray.push({ x, y, val });
    }

    const dataGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    dataGroup.setAttribute('class', 'radar-data');

    // Polygon background glow
    const glowPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    glowPoly.setAttribute('points', dataPoints.join(' '));
    glowPoly.setAttribute('fill', 'url(#radarGlow)');
    dataGroup.appendChild(glowPoly);

    // Score Polygon
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', dataPoints.join(' '));
    poly.setAttribute('fill', 'url(#polyGrad)');
    poly.setAttribute('stroke', 'var(--color-primary, #6366f1)');
    poly.setAttribute('stroke-width', '2.5');
    poly.setAttribute('filter', 'url(#shadow)');
    poly.style.transition = 'all 0.3s ease';
    dataGroup.appendChild(poly);

    // Score vertices dots
    ratingPointsArray.forEach(pt => {
      if (pt.val > 0) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pt.x);
        circle.setAttribute('cy', pt.y);
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke', 'var(--color-secondary, #a855f7)');
        circle.setAttribute('stroke-width', '2');
        dataGroup.appendChild(circle);
      }
    });
    svg.appendChild(dataGroup);

    // 4. Outer text labels for criteria (safely aligned and clamped)
    const labelsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelsGroup.setAttribute('class', 'radar-labels');

    const textRadius = this.maxRadius + 22;
    const safePadding = 15;

    for (let i = 0; i < N; i++) {
      const crit = criteria[i];
      const val = ratings[crit.id] || 0;
      const angle = angles[i];

      const x = this.cx + textRadius * Math.cos(angle);
      const y = this.cy + textRadius * Math.sin(angle);

      // Clamp label coordinates inside SVG boundary to avoid cut-off
      let labelX = x;
      let labelY = y;

      if (labelX < safePadding) {
        labelX = safePadding;
      } else if (labelX > this.width - safePadding) {
        labelX = this.width - safePadding;
      }

      if (labelY < safePadding) {
        labelY = safePadding;
      } else if (labelY > this.height - safePadding) {
        labelY = this.height - safePadding;
      }

      // Vertical alignment offset adjustment
      let dy = '0.35em';
      if (Math.abs(angle - (-Math.PI / 2)) < 0.1) {
        dy = '-0.4em'; // Top label
      } else if (Math.abs(angle - (Math.PI / 2)) < 0.1) {
        dy = '1em'; // Bottom label
      }

      // Horizontal anchor alignment
      let anchor = 'middle';
      if (Math.cos(angle) > 0.1) {
        anchor = 'start';
      } else if (Math.cos(angle) < -0.1) {
        anchor = 'end';
      }

      const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      textNode.setAttribute('x', labelX);
      textNode.setAttribute('y', labelY);
      textNode.setAttribute('text-anchor', anchor);
      textNode.setAttribute('fill', 'var(--color-text-main, #e2e8f0)');
      textNode.setAttribute('font-size', '11px');
      textNode.setAttribute('font-weight', '500');

      // Native browser tooltip
      const displayName = translateBuiltInField('criteria', crit.id, 'name', crit.name);
      const titleNode = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      titleNode.textContent = `${displayName}: ${val > 0 ? val : '-'}`;
      textNode.appendChild(titleNode);

      // Split labels mapping: 8 characters per line limit for Japanese / short labels
      const splitLimit = 8;
      const scoreStr = `: ${val > 0 ? val : '-'}`;

      if (displayName.length <= splitLimit) {
        const labelTspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        labelTspan.setAttribute('x', labelX);
        labelTspan.setAttribute('dy', dy);
        labelTspan.textContent = `${displayName}${scoreStr}`;
        textNode.appendChild(labelTspan);
      } else {
        const line1 = displayName.substring(0, splitLimit);
        let line2 = displayName.substring(splitLimit);

        if (line2.length > splitLimit) {
          line2 = line2.substring(0, splitLimit - 1) + '...';
        }

        const tspan1 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan1.setAttribute('x', labelX);
        tspan1.setAttribute('dy', '-0.3em');
        tspan1.textContent = line1;

        const tspan2 = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan2.setAttribute('x', labelX);
        tspan2.setAttribute('dy', '1.2em');
        tspan2.textContent = `${line2}${scoreStr}`;

        textNode.appendChild(tspan1);
        textNode.appendChild(tspan2);
      }

      labelsGroup.appendChild(textNode);
    }
    svg.appendChild(labelsGroup);

    // Center pivot point
    const centerPoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    centerPoint.setAttribute('cx', this.cx);
    centerPoint.setAttribute('cy', this.cy);
    centerPoint.setAttribute('r', '3');
    centerPoint.setAttribute('fill', 'rgba(255, 255, 255, 0.4)');
    svg.appendChild(centerPoint);

    this.container.appendChild(svg);
  }

  /**
   * Render placeholder when chart cannot be drawn
   * @param {string} message 
   */
  renderPlaceholder(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'radar-placeholder-container';
    wrapper.innerHTML = `
      <div class="radar-placeholder-inner">
        <svg class="radar-placeholder-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.003 9.003 0 1020.945 13H11V3.055z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
        </svg>
        <p>${message}</p>
      </div>
    `;
    this.container.appendChild(wrapper);
  }
}
