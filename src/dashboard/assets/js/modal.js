/**
 * Dashboard Modal Module
 * Modal/Lightbox UI functionality
 */

import * as state from './state.js';
import * as historyModule from './history.js';

/**
 * Open the modal for a screenshot (with history push)
 */
export function openModal(url, hash, webUrl, skipHistory = false) {
    console.log(`[UI] Opening Modal: ${webUrl} (${hash}) / Path: ${url}`);
    state.setCurrentModalUrl(url);
    state.setCurrentModalHash(hash);
    state.setCurrentWebUrl(webUrl);
    state.setIsModalOpen(true);
    document.getElementById('modal').classList.add('active');
    updateModalImage();

    // Push to browser history
    if (!skipHistory) {
        historyModule.pushState(historyModule.getCurrentState());
    }
}

/**
 * Open modal without pushing to history (for popstate)
 */
export function openModalWithoutHistory(url, hash, webUrl) {
    openModal(url, hash, webUrl, true);
}

/**
 * Close the modal (with history push)
 */
export function closeModal(skipHistory = false) {
    state.setIsModalOpen(false);
    document.getElementById('modal').classList.remove('active');

    // Push to browser history
    if (!skipHistory) {
        historyModule.pushState(historyModule.getCurrentState());
    }
}

/**
 * Close modal without pushing to history (for popstate)
 */
export function closeModalWithoutHistory() {
    closeModal(true);
}

/**
 * Update the modal image and UI
 */
export function updateModalImage(updateQAButtonsFn) {
    if (!state.currentModalUrl) return;

    let group = state.filteredScreenshots.find(s => (s.webUrl || s.url) === state.currentWebUrl);

    const img = document.getElementById('modal-img');
    img.src = state.currentModalUrl;
    img.classList.remove('loaded');
    img.onload = () => img.classList.add('loaded');

    const titleEl = document.getElementById('modal-title');
    titleEl.innerText = state.currentWebUrl || state.currentModalUrl;
    titleEl.title = state.currentWebUrl;

    const key = state.currentModalHash ? `${state.currentWebUrl}#${state.currentModalHash}` : state.currentWebUrl;
    const status = state.tags[key] || 'UNTAGGED';

    if (updateQAButtonsFn) updateQAButtonsFn(status);

    if (group) {
        updateHistoryList();
        updateModalNav();
    } else {
        document.getElementById('modal-history').innerHTML = '<div style="font-size:11px; color:#666; padding:10px;">Context not found in current filter</div>';
        const prevBtn = document.querySelector('.prev-btn');
        const nextBtn = document.querySelector('.next-btn');
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    }
}

/**
 * Update the history list in the modal
 */
export function updateHistoryList() {
    const group = state.filteredScreenshots.find(s => s.webUrl === state.currentWebUrl);
    if (!group || !group.history) return;

    const historyContainer = document.getElementById('modal-history');
    historyContainer.innerHTML = '';

    group.history.forEach(capture => {
        const isActive = capture.url === state.currentModalUrl;
        const status = state.tags[`${capture.webUrl}#${capture.hash}`] || state.tags[capture.webUrl] || 'UNTAGGED';
        const timeStr = new Date(capture.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const item = document.createElement('div');
        item.className = `history-item ${isActive ? 'active' : ''}`;
        item.onclick = (e) => {
            e.stopPropagation();
            state.setCurrentModalUrl(capture.url);
            state.setCurrentModalHash(capture.hash);
            updateModalImage();
        };

        item.innerHTML = `
            <img src="${capture.url}" class="history-thumb">
            <div class="history-status-dot qa-${status}"></div>
            <div class="history-label">${timeStr}</div>
        `;
        historyContainer.appendChild(item);
    });
}

/**
 * Update modal navigation buttons visibility
 */
export function updateModalNav() {
    const group = state.filteredScreenshots.find(s => (s.webUrl || s.url) === state.currentWebUrl);
    const idx = group ? state.filteredScreenshots.indexOf(group) : -1;

    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');

    if (!prevBtn || !nextBtn) return;

    console.log(`[ModalNav] URL: ${state.currentWebUrl}, Index: ${idx}/${state.filteredScreenshots.length - 1}`);

    prevBtn.style.display = idx > 0 ? 'flex' : 'none';
    nextBtn.style.display = (idx !== -1 && idx < state.filteredScreenshots.length - 1) ? 'flex' : 'none';
}

/**
 * Navigate to next image
 */
export function nextImage() {
    const group = state.filteredScreenshots.find(s => (s.webUrl || s.url) === state.currentWebUrl);
    const idx = state.filteredScreenshots.indexOf(group);
    if (idx !== -1 && idx < state.filteredScreenshots.length - 1) {
        const nextGroup = state.filteredScreenshots[idx + 1];
        openModal(nextGroup.url, nextGroup.hash, nextGroup.webUrl || nextGroup.url);
    }
}

/**
 * Navigate to previous image
 */
export function prevImage() {
    const group = state.filteredScreenshots.find(s => (s.webUrl || s.url) === state.currentWebUrl);
    const idx = state.filteredScreenshots.indexOf(group);
    if (idx > 0) {
        const prevGroup = state.filteredScreenshots[idx - 1];
        openModal(prevGroup.url, prevGroup.hash, prevGroup.webUrl || prevGroup.url);
    }
}

/**
 * Preload neighbor images for smoother navigation
 */
export function preloadNeighbors(idx) {
    if (idx < state.filteredScreenshots.length - 1) {
        new Image().src = state.filteredScreenshots[idx + 1].url;
    }
    if (idx > 0) {
        new Image().src = state.filteredScreenshots[idx - 1].url;
    }
}

/**
 * Update QA buttons state
 */
export function updateQAButtons(currentStatus) {
    document.querySelectorAll('.qa-btn').forEach(btn => btn.classList.remove('selected'));
    if (currentStatus === 'PASS') document.querySelector('.btn-pass')?.classList.add('selected');
    if (currentStatus === 'FAIL') {
        document.querySelector('.btn-fail')?.classList.add('selected');
        document.getElementById('fail-reason-container').style.display = 'block';
        const key = state.currentModalHash ? `${state.currentWebUrl}#${state.currentModalHash}` : state.currentWebUrl;
        document.getElementById('fail-reason').value = state.reasons[key] || '';
    } else {
        document.getElementById('fail-reason-container').style.display = 'none';
    }
    if (currentStatus === 'BLOCK') document.querySelector('.btn-block')?.classList.add('selected');
}

/**
 * Switch to a duplicate version
 */
export function switchDuplicate(url) {
    console.log("Switching to duplicate:", url);
    state.setCurrentModalUrl(url);
    updateModalImage();
}
