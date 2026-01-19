/**
 * Dashboard Main Entry Point
 * Initializes all modules and sets up event listeners
 */

import * as state from './state.js';
import * as api from './api.js';
import * as filter from './filter.js';
import * as gallery from './gallery.js';
import * as modal from './modal.js';
import * as browserHistory from './history.js';

// Initialize DOM elements
state.initDOMElements();

// ===== Data Update Function =====
async function update(isSwitching = false) {
    try {
        const res = await fetch(`${state.API_URL}?env=${state.currentEnvironment}`);
        const data = await res.json();

        // Hide loading indicator
        if (state.loading.innerText === 'Switching Environment...') {
            state.loading.style.display = 'none';
            state.loading.innerText = 'Loading more...';
        }

        // Update Runner UI
        state.setIsRunning(data.isRunning);
        state.setQueueLength(data.queueLength || 0);

        const queueStatus = document.getElementById('queue-status');
        if (state.queueLength > 0) {
            queueStatus.style.display = 'inline-block';
            queueStatus.innerText = `Queue: ${state.queueLength}`;
        } else {
            queueStatus.style.display = 'none';
        }

        // Update Status UI
        const effectiveRunningState = data.isRunning || (data.queueLength && data.queueLength > 0);
        if (effectiveRunningState) {
            state.runnerStatus.innerText = data.queueLength > 0 ? `Queueing (${data.queueLength})...` : "Running...";
            state.runnerStatus.className = 'status-badge status-running';
            state.btnStart.style.display = 'none';
            state.btnStop.style.display = 'inline-block';
            state.inputUrl.disabled = true;
        } else {
            state.runnerStatus.innerText = "Idle";
            state.runnerStatus.className = 'status-badge status-idle';
            state.btnStart.style.display = 'block';
            state.btnStart.classList.remove('btn-disabled');
            state.btnStop.style.display = 'none';
            state.inputUrl.disabled = false;
        }

        // Update Supervisor UI
        const supBadge = document.getElementById('supervisor-badge');
        const supStatus = document.getElementById('supervisor-status');
        if (data.supervisor) {
            supBadge.style.display = 'inline-block';
            supStatus.innerText = data.supervisor.overall || 'Unknown';

            if (data.supervisor.overall === 'healthy') {
                supBadge.style.background = '#064e3b';
                supBadge.style.color = '#34d399';
            } else if (data.supervisor.overall === 'degraded') {
                supBadge.style.background = '#451a03';
                supBadge.style.color = '#fbbf24';
            } else if (data.supervisor.overall === 'running') {
                supBadge.style.background = '#172554';
                supBadge.style.color = '#60a5fa';
            } else {
                supBadge.style.background = '#334155';
                supBadge.style.color = '#94a3b8';
            }
        }

        state.setTags(data.tags || {});
        state.setReasons(data.reasons || {});
        gallery.updateVisibleTags();

        const oldLength = state.serverScreenshots.length;
        state.setServerScreenshots(data.screenshots);

        // Calculate Counts
        const typeCounts = { ALL: 0, MODAL: 0, DETAIL: 0, PAGE: 0, DUP: 0 };
        const statusCounts = { PASS: 0, FAIL: 0, BLOCK: 0, UNTAGGED: 0 };
        const filteredCounts = { ALL: 0, MODAL: 0, DETAIL: 0, PAGE: 0, DUP: 0 };

        const tempUrlGroups = new Map();
        state.serverScreenshots.forEach(shot => {
            const url = shot.webUrl || shot.url;
            if (!tempUrlGroups.has(url)) tempUrlGroups.set(url, []);
            tempUrlGroups.get(url).push(shot);
        });

        tempUrlGroups.forEach((captures, url) => {
            captures.sort((a, b) => b.time - a.time);
            const latest = captures[0];
            const effectiveUrl = latest.webUrl || latest.url;
            const latestStatus = state.tags[`${effectiveUrl}#${latest.hash}`] || state.tags[effectiveUrl] || 'UNTAGGED';
            const type = filter.getScreenshotType(latest.url);

            typeCounts.ALL++;
            if (typeCounts[type] !== undefined) typeCounts[type]++;
            if (captures.length > 1) typeCounts.DUP++;

            if (statusCounts[latestStatus] !== undefined) {
                statusCounts[latestStatus]++;
            } else {
                statusCounts.UNTAGGED++;
            }

            let matchesCurrentStatus = state.currentStatusFilter === 'ALL' || captures.some(cap => {
                const cUrl = cap.webUrl || cap.url;
                const s = state.tags[`${cUrl}#${cap.hash}`] || state.tags[cUrl] || 'UNTAGGED';
                return s === state.currentStatusFilter;
            });

            if (matchesCurrentStatus) {
                filteredCounts.ALL++;
                if (filteredCounts[type] !== undefined) filteredCounts[type]++;
                if (captures.length > 1) filteredCounts.DUP++;
            }
        });

        // Update UI counts
        document.getElementById('count').innerText = data.searchedCount;
        document.getElementById('shot-count').innerText = typeCounts.ALL;

        const traceLink = document.getElementById('trace-link');
        if (data.latestTrace) {
            traceLink.href = data.latestTrace;
            traceLink.style.display = 'inline-block';
        }

        const appendFiltered = (total, filtered) => state.currentStatusFilter === 'ALL' ? total : `${total} (${filtered})`;

        document.getElementById('count-all').innerText = appendFiltered(typeCounts.ALL, filteredCounts.ALL);
        document.getElementById('count-modal').innerText = appendFiltered(typeCounts.MODAL, filteredCounts.MODAL);
        document.getElementById('count-detail').innerText = appendFiltered(typeCounts.DETAIL, filteredCounts.DETAIL);
        document.getElementById('count-page').innerText = appendFiltered(typeCounts.PAGE, filteredCounts.PAGE);
        document.getElementById('count-duplicate').innerText = appendFiltered(typeCounts.DUP, filteredCounts.DUP);

        document.getElementById('count-pass').innerText = statusCounts.PASS;
        document.getElementById('count-fail').innerText = statusCounts.FAIL;
        document.getElementById('count-block').innerText = statusCounts.BLOCK;
        document.getElementById('count-untagged').innerText = statusCounts.UNTAGGED;

        const failBtn = document.getElementById('btn-research-fail');
        document.getElementById('fail-count-btn').innerText = statusCounts.FAIL;
        failBtn.style.display = statusCounts.FAIL > 0 ? 'inline-block' : 'none';

        // Refresh gallery if data changed
        if (state.filteredScreenshots.length === 0 && state.visualScreenshots.length === 0 && state.serverScreenshots.length > 0) {
            filter.applyFilterAndReset(gallery.loadMore);
        } else if (state.serverScreenshots.length !== oldLength || (data.latestScanTime && data.latestScanTime > state.lastScanTime)) {
            state.setLastScanTime(data.latestScanTime || 0);
            filter.applyFilterAndReset(gallery.loadMore);
        }

        if (state.isModalOpen) modal.updateModalNav();

    } catch (e) {
        console.error("Dashboard update failed:", e);
    }
}

// ===== Expose Functions to Global Scope (for inline onclick handlers) =====
window.switchEnvironment = (env) => {
    filter.switchEnvironment(env, update);
    browserHistory.pushState(browserHistory.getCurrentState());
};
window.setFilter = (f) => {
    filter.setFilter(f, () => filter.applyFilterAndReset(gallery.loadMore));
    browserHistory.pushState(browserHistory.getCurrentState());
};
window.setStatusFilter = (s) => {
    filter.setStatusFilter(s, () => filter.applyFilterAndReset(gallery.loadMore));
    browserHistory.pushState(browserHistory.getCurrentState());
};
window.startSearch = api.startSearch;
window.stopSearch = api.stopSearch;
window.researchFailures = async () => { await api.researchFailures(); update(); };
window.setTag = (status) => api.setTag(status, modal.nextImage);
window.saveReason = api.saveReason;
window.openModal = modal.openModal;
window.closeModal = modal.closeModal;
window.prevImage = modal.prevImage;
window.nextImage = modal.nextImage;
window.switchDuplicate = modal.switchDuplicate;

// ===== Event Delegation for Card Clicks =====
state.gallery.addEventListener('click', (e) => {
    const card = e.target.closest('.shot-card');
    if (card) {
        modal.openModal(card.dataset.url, card.dataset.hash, card.dataset.webUrl);
    }
});

// ===== Keyboard Navigation =====
document.addEventListener('keydown', (e) => {
    if (!state.isModalOpen) return;
    console.log(`[UI] KeyDown: ${e.key} (Target: ${e.target.tagName})`);

    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        if (e.key === 'Escape') e.target.blur();
        return;
    }

    if (e.key === 'ArrowLeft') { e.preventDefault(); modal.prevImage(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); modal.nextImage(); }
    if (e.key === 'Escape') modal.closeModal();
    if (e.key === "1") api.setTag('PASS', modal.nextImage);
    if (e.key === "2") api.setTag('FAIL', modal.nextImage);
    if (e.key === "3") api.setTag('BLOCK', modal.nextImage);
});

// ===== Infinite Scroll Observer =====
if ('IntersectionObserver' in window) {
    state.setScrollObserver(new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) gallery.loadMore();
    }, { rootMargin: '200px' }));
    if (state.sentinel) state.scrollObserver.observe(state.sentinel);
}

// ===== Dynamic Styles =====
const styleSheet = document.createElement("style");
styleSheet.innerText = `
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .dropdown-menu {
        position: absolute; top: 100%; left: 0;
        background: #1e293b; border: 1px solid #334155; border-radius: 4px;
        padding: 4px 0; min-width: 300px; max-width: 90vw; max-height: 50vh;
        overflow-y: auto; z-index: 9999; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
        display: none;
    }
    .dropdown-menu.show { display: block; animation: fadeIn 0.2s; }
    .dropdown-item {
        padding: 8px 12px; cursor: pointer; font-size: 13px;
        color: #cbd5e1; border-bottom: 1px solid #334155;
    }
    .dropdown-item:last-child { border-bottom: none; }
    .dropdown-item:hover { background: #334155; color: white; }
    .dropdown-item.active { background: #0ea5e9; color: white; }
`;
document.head.appendChild(styleSheet);

// ===== Browser History Integration =====
browserHistory.setupPopStateListener({
    openModalWithoutHistory: modal.openModalWithoutHistory,
    closeModalWithoutHistory: modal.closeModalWithoutHistory,
    switchEnvironmentWithoutHistory: (env) => filter.switchEnvironment(env, update),
    setFilterWithoutHistory: (f) => filter.setFilter(f, () => filter.applyFilterAndReset(gallery.loadMore)),
    setStatusFilterWithoutHistory: (s) => filter.setStatusFilter(s, () => filter.applyFilterAndReset(gallery.loadMore))
});

// Initialize state from URL on page load
browserHistory.replaceState(browserHistory.getCurrentState());

// ===== Initial Load & Polling =====
update();
setInterval(update, 2000);

console.log('[Dashboard] ES Modules loaded successfully ✓');
console.log('[Dashboard] Browser History API enabled ✓');
