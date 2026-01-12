

import { state, BATCH_SIZE } from './state.js';
import { openModal } from './modal.js';
import { filenameToRoute, calculateDepth } from './utils/pathUtils.js';

export function getScreenshotType(input) {
    const url = typeof input === 'string' ? input : input.url;
    const lower = url.toLowerCase();
    if (lower.includes('modal-')) return 'MODAL';
    if (lower.includes('detail-')) return 'DETAIL';
    return 'PAGE';
}

export function normalizePath(fileName) {
    return filenameToRoute(fileName);
}

export function getScreenshotDepth(input) {
    try {
        const url = typeof input === 'string' ? input : input.url;
        const fileName = url.split('/').pop() || '';
        const norm = filenameToRoute(fileName);
        return calculateDepth(norm);
    } catch { return 0; }
}

export function isGolden(input) {
    try {
        const url = typeof input === 'string' ? input : input.url;
        const fileName = url.split('/').pop() || '';
        // Check for golden_ prefix in filename
        return fileName.toLowerCase().includes('golden_');
    } catch { return false; }
}

// Set initial tab
if (!state.filters) state.filters = {};
window.setTab = (tabName) => {
    state.currentTab = tabName; // 'EXPLORATION' or 'GOLDEN'

    // UI Update
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (tabName === 'EXPLORATION' && btn.innerText.includes('EXPLORATION')) btn.classList.add('active');
        else if (tabName === 'GOLDEN' && btn.innerText.includes('GOLDEN')) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // Set Date Filter Default based on Tab
    const dateSelect = document.getElementById('date-filter');
    if (tabName === 'GOLDEN') {
        // Default to latest date if available
        if (state.availableDates && state.availableDates.length > 0) {
            state.currentDate = state.availableDates[0];
        }
    } else {
        // EXPLORATION: Default to All Dates
        state.currentDate = '';
    }

    // Sync Dropdown
    if (dateSelect) dateSelect.value = state.currentDate || "";

    // Toggle QA Filters Visibility
    const qaContainer = document.getElementById('qa-filters');
    if (qaContainer) {
        if (tabName === 'GOLDEN') {
            qaContainer.style.display = 'none';
            state.filters.qa = 'ALL'; // Reset QA filter so we don't filter by it while hidden
        } else {
            qaContainer.style.display = 'inline';
        }
    }

    updateFilterUI(); // Refresh UI to reflect reset QA if needed
    applyFilterAndReset(); // This triggers updateFilterCounts() internaly
};

export function createCard(item) {
    const url = typeof item === 'string' ? item : item.url;
    const confidence = typeof item === 'object' ? item.confidence : undefined;

    const fileName = url.split('/').pop() || '';
    const displayPath = normalizePath(fileName);

    const type = getScreenshotType(url);
    const badgeClass = `badge-${type.toLowerCase()}`;
    const status = state.tags[url];
    const golden = isGolden(url);

    const div = document.createElement('div');
    div.className = 'shot-card';
    div.dataset.url = url;
    div.onclick = () => openModal(url);

    let statusHtml = '';
    if (status) statusHtml = `<span class="qa-tag qa-${status}">${status}</span>`;

    const starHtml = golden ? `<div class="star-icon">⭐</div>` : '';

    let tooltipHtml = '';
    if (!golden) {
        const tooltipText = `
            <div class="tooltip-row"><strong>Type:</strong> ${type}</div>
            <div class="tooltip-row"><strong>Path:</strong> ${displayPath}</div>
            <div class="tooltip-row"><strong>Status:</strong> ${status || 'Untagged'}</div>
            <div class="tooltip-row"><strong>Golden:</strong> ${golden ? 'Yes' : 'No'}</div>
        `;
        tooltipHtml = `<div class="card-tooltip">${tooltipText}</div>`;
    } else if (confidence !== undefined) {
        // Golden Path with Confidence Score
        const confidencePercent = Math.round(confidence * 100);
        const tooltipText = `
            <div class="tooltip-row"><strong>Type:</strong> ${type}</div>
            <div class="tooltip-row"><strong>Path:</strong> ${displayPath}</div>
            <div class="tooltip-row"><strong>Confidence:</strong> ${confidencePercent}%</div>
            <div class="tooltip-row"><strong>Status:</strong> ${status || 'Verified'}</div>
        `;
        tooltipHtml = `<div class="card-tooltip">${tooltipText}</div>`;
    }

    div.innerHTML = `
        ${statusHtml}
        ${starHtml}
        <span class="badge ${badgeClass}" style="right: ${golden ? '30px' : '5px'}">${type}</span>
        <div style="cursor:pointer">
            <img data-src="${url}" class="shot-img" alt="${displayPath}">
        </div>
        <div class="shot-info">${displayPath}</div>
        ${tooltipHtml}
    `;

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

export function loadMore() {
    const gallery = document.getElementById('gallery');
    const loading = document.getElementById('loading');

    let start = 0;
    if (state.visualScreenshots.length > 0) {
        const lastItem = state.visualScreenshots[state.visualScreenshots.length - 1];
        const lastUrl = typeof lastItem === 'string' ? lastItem : lastItem.url;
        const lastIdx = state.filteredScreenshots.findIndex(item => {
            const url = typeof item === 'string' ? item : item.url;
            return url === lastUrl;
        });
        if (lastIdx !== -1) {
            start = lastIdx + 1;
        } else {
            start = state.visualScreenshots.length;
        }
    }

    if (start >= state.filteredScreenshots.length) {
        loading.classList.remove('visible');
        loading.style.display = 'none';
        return;
    }

    loading.classList.add('visible');
    loading.style.display = 'block';

    const end = Math.min(start + BATCH_SIZE, state.filteredScreenshots.length);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
        const item = state.filteredScreenshots[i];
        const url = typeof item === 'string' ? item : item.url;
        const alreadyShown = state.visualScreenshots.some(v => {
            const vUrl = typeof v === 'string' ? v : v.url;
            return vUrl === url;
        });
        if (!alreadyShown) {
            fragment.appendChild(createCard(item));
            state.visualScreenshots.push(item);
        }
    }
    gallery.appendChild(fragment);

    if (state.visualScreenshots.length >= state.filteredScreenshots.length) {
        loading.classList.remove('visible');
        loading.style.display = 'none';
    } else {
        loading.classList.remove('visible');
    }
}

export function setFilter(filterText) {
    // Type filters
    if (['ALL', 'MODAL', 'DETAIL', 'PAGE'].includes(filterText)) {
        state.filters.type = filterText;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const onclick = btn.getAttribute('onclick') || '';
            // Check if this is a Type filter button (not DEPTH or QA)
            const isTypeBtn = !onclick.includes('DEPTH') && !onclick.includes('QA') && !onclick.includes('LEVEL');
            if (isTypeBtn) {
                if (onclick.includes(`setFilter('${filterText}')`)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
    }
    // Depth filters
    else if (['DEPTH_ALL', 'LEVEL 1', 'LEVEL 2', 'LEVEL 3+'].includes(filterText)) {
        state.filters.depth = filterText === 'DEPTH_ALL' ? 'ALL' : filterText;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const onclick = btn.getAttribute('onclick') || '';
            // Check if this is a Depth filter button
            const isDepthBtn = onclick.includes('DEPTH') || onclick.includes('LEVEL');
            if (isDepthBtn) {
                if (onclick.includes(`setFilter('${filterText}')`)) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            }
        });
    }
    // QA filters
    else if (['QA_ALL', 'PASS', 'FAIL', 'UNTAGGED'].includes(filterText)) {
        state.filters.qa = filterText === 'QA_ALL' ? 'ALL' : filterText;
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const onclick = btn.getAttribute('onclick') || '';
            if (onclick.includes(`setFilter('${filterText}')`)) {
                btn.classList.add('active');
            } else if (onclick.includes('QA') || onclick.includes('PASS') || onclick.includes('FAIL') || onclick.includes('UNTAGGED')) {
                btn.classList.remove('active');
            }
        });
    }
    applyFilterAndReset();
}

function updateFilterUI() {
    // Sync filter button states with current state
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';

        // Type filters
        if (onclick.includes(`setFilter('${state.filters.type}')`) && !onclick.includes('DEPTH') && !onclick.includes('QA')) {
            btn.classList.add('active');
        }
        // Depth filters
        else if (state.filters.depth === 'ALL' && onclick.includes("setFilter('DEPTH_ALL')")) {
            btn.classList.add('active');
        }
        else if (onclick.includes(`setFilter('${state.filters.depth}')`) && (onclick.includes('LEVEL') || onclick.includes('DEPTH'))) {
            btn.classList.add('active');
        }
        // QA filters
        else if (state.filters.qa === 'ALL' && onclick.includes("setFilter('QA_ALL')")) {
            btn.classList.add('active');
        }
        else if (onclick.includes(`setFilter('${state.filters.qa}')`) && (onclick.includes('QA') || onclick.includes('PASS') || onclick.includes('FAIL') || onclick.includes('UNTAGGED'))) {
            btn.classList.add('active');
        }
    });
}

// Update filter badges based on current Tab + Date context
function updateFilterCounts() {
    // 1. Determine "Universe" (Tab + Date)
    // Same logic as applyFilterAndReset, but ignoring specific Type/Depth/QA filters
    const currentTab = state.currentTab || 'EXPLORATION';
    const currentDate = state.currentDate;

    // We start with ALL screenshots from server
    const universe = state.serverScreenshots.filter(item => {
        const url = typeof item === 'string' ? item : item.url;
        // Tab Logic
        const isGoldenItem = isGolden(url);
        if (currentTab === 'GOLDEN') {
            if (!isGoldenItem) return false;
        } else {
            if (isGoldenItem) return false;
        }

        // Date Logic (Since Date is a top-level filter in dashboard)
        if (state.screenshotsByDate && currentDate) {
            return true;
        }
        return true;
    });

    // 2. Initialize Counts
    const counts = {
        // Type
        'ALL': 0, 'MODAL': 0, 'DETAIL': 0, 'PAGE': 0,
        // Depth
        'DEPTH_ALL': 0, 'LEVEL 1': 0, 'LEVEL 2': 0, 'LEVEL 3+': 0,
        // QA
        'QA_ALL': 0, 'PASS': 0, 'FAIL': 0, 'BLOCK': 0, 'UNTAGGED': 0
    };

    // 3. Count
    universe.forEach(item => {
        const url = typeof item === 'string' ? item : item.url;
        // Type
        const type = getScreenshotType(url);
        counts['ALL']++;
        if (counts[type] !== undefined) counts[type]++;

        // Depth
        const depth = getScreenshotDepth(url);
        counts['DEPTH_ALL']++;
        if (depth <= 2) counts['LEVEL 1']++;
        else if (depth === 3) counts['LEVEL 2']++;
        else counts['LEVEL 3+']++;

        // QA
        const status = state.tags[url] || 'UNTAGGED';
        counts['QA_ALL']++;
        if (counts[status] !== undefined) counts[status]++;
    });

    // 4. Update DOM
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        const onclick = btn.getAttribute('onclick') || '';
        const badge = btn.querySelector('.count-badge');
        if (!badge) return;

        let key = null;

        // Map button to key
        if (onclick.includes("setFilter('ALL')") && !onclick.includes("QA_") && !onclick.includes("DEPTH_")) key = 'ALL';
        else if (onclick.includes("'MODAL'")) key = 'MODAL';
        else if (onclick.includes("'detail'") || onclick.includes("'DETAIL'")) key = 'DETAIL'; // normalize case
        else if (onclick.includes("'PAGE'")) key = 'PAGE';

        else if (onclick.includes("'DEPTH_ALL'")) key = 'DEPTH_ALL';
        else if (onclick.includes("'LEVEL 1'")) key = 'LEVEL 1';
        else if (onclick.includes("'LEVEL 2'")) key = 'LEVEL 2';
        else if (onclick.includes("'LEVEL 3+'")) key = 'LEVEL 3+';

        else if (onclick.includes("'QA_ALL'")) key = 'QA_ALL';
        else if (onclick.includes("'PASS'")) key = 'PASS';
        else if (onclick.includes("'FAIL'")) key = 'FAIL';
        else if (onclick.includes("'BLOCK'")) key = 'BLOCK';
        else if (onclick.includes("'UNTAGGED'")) key = 'UNTAGGED';

        if (key && counts[key] !== undefined) {
            badge.innerText = counts[key];
            // Optional: Hide badge if 0? Or keep for consistency? User mock showed 0. Keep 0.
        }
    });
}

export function applyFilterAndReset() {
    updateFilterCounts(); // Update badges whenever we filter (or rather, whenever data changes, but this is safe)

    state.filteredScreenshots = state.serverScreenshots.filter(item => {
        const url = typeof item === 'string' ? item : item.url;
        const type = getScreenshotType(url);
        const status = state.tags[url];
        const depth = getScreenshotDepth(url);
        const isGoldenItem = isGolden(url);

        const tab = state.currentTab || 'EXPLORATION';

        if (tab === 'GOLDEN') {
            if (!isGoldenItem) return false;
        } else {
            if (isGoldenItem) return false;
        }

        if (state.filters.type !== 'ALL') {
            if (type !== state.filters.type) return false;
        }

        if (state.filters.depth !== 'ALL') {
            if (state.filters.depth === 'LEVEL 1' && depth > 2) return false;
            if (state.filters.depth === 'LEVEL 2' && depth !== 3) return false;
            if (state.filters.depth === 'LEVEL 3+' && depth < 4) return false;
        }

        if (state.filters.qa !== 'ALL') {
            if (state.filters.qa === 'UNTAGGED') {
                if (status) return false;
            } else {
                if (status !== state.filters.qa) return false;
            }
        }
        return true;
    });

    state.visualScreenshots = [];
    const gallery = document.getElementById('gallery');
    gallery.innerHTML = '';

    if (state.filteredScreenshots.length === 0) {
        gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #666;">No screenshots found matching criteria.</div>';
        const loading = document.getElementById('loading');
        if (loading) loading.style.display = 'none';
        return;
    }

    loadMore();
}

export function updateVisibleTags() {
    document.querySelectorAll('.shot-card').forEach(card => {
        const url = card.dataset.url;
        const status = state.tags[url];
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
