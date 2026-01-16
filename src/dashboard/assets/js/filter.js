/**
 * Dashboard Filter Module
 * Filtering and environment switching logic
 */

import * as state from './state.js';

/**
 * Get screenshot type from URL
 */
export function getScreenshotType(url) {
    const lower = url.toLowerCase();
    if (lower.includes('modal-')) return 'MODAL';
    if (lower.includes('detail-')) return 'DETAIL';
    return 'PAGE';
}

/**
 * Switch environment (stage/dev)
 */
export function switchEnvironment(env, updateFn) {
    state.setCurrentEnvironment(env);

    // Update UI
    document.getElementById('env-stage').classList.toggle('active', env === 'stage');
    document.getElementById('env-dev').classList.toggle('active', env === 'dev');

    // Update URL input
    state.inputUrl.value = env === 'stage' ? 'https://stage.ianai.co/' : 'https://dev.ianai.co/';

    // Reset and reload
    state.setServerScreenshots([]);
    state.setFilteredScreenshots([]);
    state.setVisualScreenshots([]);
    state.gallery.innerHTML = '';

    // Show loading state
    state.loading.style.display = 'block';
    state.loading.innerText = 'Switching Environment...';
    resetStats();

    if (updateFn) updateFn(true);
}

/**
 * Reset statistic displays
 */
export function resetStats() {
    ['count-all', 'count-modal', 'count-detail', 'count-page', 'count-duplicate',
        'count-pass', 'count-fail', 'count-block', 'count-untagged', 'count', 'shot-count'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = '-';
        });
}

/**
 * Set type filter (ALL, PAGE, MODAL, DETAIL, DUP)
 */
export function setFilter(filter, applyFn) {
    state.setCurrentFilter(filter);
    document.querySelectorAll('#type-filters .filter-btn').forEach(btn => {
        const btnText = btn.childNodes[0].textContent.trim();
        btn.classList.toggle('active', btnText === filter);
    });
    if (applyFn) applyFn();
}

/**
 * Set status filter (PASS, FAIL, BLOCK, UNTAGGED)
 */
export function setStatusFilter(status, applyFn) {
    if (state.currentStatusFilter === status) {
        state.setCurrentStatusFilter('ALL');
    } else {
        state.setCurrentStatusFilter(status);
    }

    document.querySelectorAll('#status-filters .filter-btn').forEach(btn => {
        const btnText = btn.childNodes[0].textContent.trim();
        if (status === 'UNTAGGED') {
            btn.classList.toggle('active', state.currentStatusFilter === 'UNTAGGED' && btnText === '?');
        } else {
            btn.classList.toggle('active', state.currentStatusFilter === status && btnText === status);
        }
    });
    if (applyFn) applyFn();
}

/**
 * Apply current filters and reset gallery
 */
export function applyFilterAndReset(loadMoreFn) {
    // Group by URL (webUrl) to show capture versions
    const urlGroups = new Map();
    state.serverScreenshots.forEach(shot => {
        const url = shot.webUrl || shot.url;
        if (!urlGroups.has(url)) {
            urlGroups.set(url, {
                webUrl: url,
                captures: [],
                latest: null
            });
        }
        const group = urlGroups.get(url);
        group.captures.push(shot);
    });

    // Sort captures and pick latest
    let baseList = [];
    urlGroups.forEach(group => {
        group.captures.sort((a, b) => b.time - a.time);
        group.latest = group.captures[0];

        const effectiveUrl = group.latest.webUrl || group.latest.url;
        const latestStatus = state.tags[`${effectiveUrl}#${group.latest.hash}`] || state.tags[effectiveUrl] || 'UNTAGGED';

        let matchesStatus = false;
        if (state.currentStatusFilter === 'ALL') {
            matchesStatus = true;
        } else {
            matchesStatus = group.captures.some(cap => {
                const cUrl = cap.webUrl || cap.url;
                const s = state.tags[`${cUrl}#${cap.hash}`] || state.tags[cUrl] || 'UNTAGGED';
                return s === state.currentStatusFilter;
            });
        }

        if (matchesStatus) {
            baseList.push({
                ...group.latest,
                history: group.captures,
                count: group.captures.length,
                primaryStatus: latestStatus
            });
        }
    });

    // Apply Type Filter
    if (state.currentFilter !== 'ALL') {
        if (state.currentFilter === 'DUP') {
            baseList = baseList.filter(shot => shot.count > 1);
        } else {
            baseList = baseList.filter(shot => getScreenshotType(shot.url) === state.currentFilter);
        }
    }

    state.setFilteredScreenshots(baseList);
    state.setVisualScreenshots([]);
    state.gallery.innerHTML = '';

    if (loadMoreFn) loadMoreFn();

    // Re-connect observer
    if (state.scrollObserver && state.sentinel) {
        state.scrollObserver.disconnect();
        state.scrollObserver.observe(state.sentinel);
    }
}
