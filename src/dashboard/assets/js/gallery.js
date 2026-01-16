/**
 * Dashboard Gallery Module
 * Gallery rendering and card creation
 */

import * as state from './state.js';
import { getScreenshotType } from './filter.js';

/**
 * Load more items into the gallery
 */
export async function loadMore() {
    let start = 0;
    if (state.visualScreenshots.length > 0) {
        const lastIdx = state.filteredScreenshots.indexOf(state.visualScreenshots[state.visualScreenshots.length - 1]);
        if (lastIdx !== -1) start = lastIdx + 1;
    }

    if (start >= state.filteredScreenshots.length) {
        state.loading.classList.remove('visible');
        return;
    }

    state.loading.classList.add('visible');
    const end = Math.min(start + state.BATCH_SIZE, state.filteredScreenshots.length);
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        const shot = state.filteredScreenshots[i];
        if (!state.visualScreenshots.includes(shot)) {
            fragment.appendChild(createCard(shot));
            state.visualScreenshots.push(shot);
        }
    }

    state.gallery.appendChild(fragment);
    state.loading.classList.remove('visible');

    // If sentinel is still visible, load more immediately
    requestAnimationFrame(() => {
        const rect = state.sentinel.getBoundingClientRect();
        if (rect.top < window.innerHeight + 200 && state.visualScreenshots.length < state.filteredScreenshots.length) {
            loadMore();
        }
    });
}

/**
 * Create a card element for a screenshot
 */
export function createCard(shot, openModalFn) {
    const url = shot.url;
    const webUrl = shot.webUrl || url;
    const name = webUrl.split('/').pop().substring(0, 50) || 'home';
    const type = getScreenshotType(url);
    const badgeClass = `badge-${type.toLowerCase()}`;
    const status = state.tags[`${webUrl}#${shot.hash}`] || state.tags[webUrl];

    const div = document.createElement('div');
    div.className = 'shot-card';
    div.dataset.url = url;

    // Store data for modal opening
    div.dataset.hash = shot.hash || '';
    div.dataset.webUrl = webUrl;

    let statusHtml = '';
    if (status) statusHtml = `<span class="qa-tag qa-${status}">${status}</span>`;

    let dupHtml = '';
    if (shot.count > 1) {
        dupHtml = `<span class="duplicate-badge">v${shot.count}</span>`;
    }

    let confidenceHtml = '';
    if (shot.confidence !== null && shot.confidence !== undefined && !isNaN(shot.confidence)) {
        const score = Math.round(shot.confidence * 100);
        const color = score >= 80 ? '#10b981' : (score >= 50 ? '#f59e0b' : '#ef4444');
        confidenceHtml = `<span style="position:absolute; bottom:30px; left:5px; background:${color}; color:#fff; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:800; box-shadow:0 2px 4px rgba(0,0,0,0.5); z-index:5;" title="${shot.isStable ? 'Stable' : 'Unstable'}">${score}%</span>`;
    }

    div.innerHTML = `
        ${statusHtml}
        <span class="badge ${badgeClass}">${type}</span>
        ${dupHtml}
        ${confidenceHtml}
        <div style="cursor:pointer">
            <img data-src="${url}" class="shot-img" alt="${name}">
        </div>
        <div class="shot-info">${name}</div>
    `;

    // Lazy load images
    const img = div.querySelector('img');
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const target = entry.target;
                target.src = target.dataset.src;
                target.onload = () => target.classList.add('loaded');
                obs.unobserve(target);
            }
        });
    });
    obs.observe(img);

    return div;
}

/**
 * Update visible tags on all cards
 */
export function updateVisibleTags() {
    document.querySelectorAll('.shot-card').forEach(card => {
        const url = card.dataset.url;
        const shot = state.serverScreenshots.find(s => s.url === url);
        if (!shot) return;
        const webUrl = shot.webUrl || url;
        const status = state.tags[`${webUrl}#${shot.hash}`] || state.tags[webUrl];

        const existingTag = card.querySelector('.qa-tag');
        if (existingTag) existingTag.remove();

        if (status) {
            const tag = document.createElement('span');
            tag.className = `qa-tag qa-${status}`;
            tag.innerText = status;
            card.appendChild(tag);
        }
    });
}
