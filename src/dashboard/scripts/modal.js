
import { state } from './state.js';
import { setTagApi } from './api.js';
import { updateVisibleTags, isGolden } from './gallery.js';

export function openModal(url) {
    state.currentModalUrl = url;
    state.isModalOpen = true;
    document.getElementById('modal').classList.add('active');
    updateModalImage();
}

export function closeModal() {
    state.isModalOpen = false;
    document.getElementById('modal').classList.remove('active');
}

export async function setTag(status) {
    if (!state.currentModalUrl) return;
    // Safety check: Prevent tagging if golden
    if (isGolden(state.currentModalUrl)) return;

    state.tags[state.currentModalUrl] = status;
    updateQAButtons(status);
    updateVisibleTags();
    try {
        await setTagApi(state.currentModalUrl, status);
    } catch (e) { }
}

export function updateQAButtons(currentStatus) {
    document.querySelectorAll('.qa-btn').forEach(btn => btn.classList.remove('selected'));
    if (currentStatus === 'PASS') document.querySelector('.btn-pass').classList.add('selected');
    if (currentStatus === 'FAIL') document.querySelector('.btn-fail').classList.add('selected');
    if (currentStatus === 'BLOCK') document.querySelector('.btn-block').classList.add('selected');
}

export function updateModalImage() {
    if (!state.currentModalUrl) return;
    const idx = state.filteredScreenshots.findIndex(item => {
        const url = typeof item === 'string' ? item : item.url;
        return url === state.currentModalUrl;
    });
    const name = state.currentModalUrl.split('/').pop().replace('screenshot-', '').replace('.webp', '');
    const img = document.getElementById('modal-img');
    img.src = state.currentModalUrl;
    const total = state.filteredScreenshots.length;

    // Convert filename to readable URL path for display
    // e.g. screenshot-app-home-2026... -> /app/home
    let urlPath = name.split('_')[0]; // remove timestamp
    urlPath = urlPath.replace(/^screenshot-/, '').replace(/-/g, '/');
    if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;

    document.getElementById('modal-caption').innerHTML = `
        <div style="font-size:14px; color:#aaa; margin-bottom:4px;">${name}</div>
        <div style="font-size:16px; color:#fff; font-weight:bold;">${urlPath}</div>
        <div style="font-size:12px; color:#666; margin-top:4px;">Image ${idx + 1} of ${total}</div>
    `;

    updateQAButtons(state.tags[state.currentModalUrl]);

    // Hide QA Controls if Golden
    const qaToolbar = document.querySelector('.qa-toolbar');
    if (isGolden(state.currentModalUrl)) {
        if (qaToolbar) qaToolbar.style.display = 'none';
    } else {
        if (qaToolbar) qaToolbar.style.display = 'flex'; // Restore flex (or block)
    }

    updateModalNav();
    preloadNeighbors(idx);
}

export function updateModalNav() {
    const idx = state.filteredScreenshots.findIndex(item => {
        const url = typeof item === 'string' ? item : item.url;
        return url === state.currentModalUrl;
    });
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');

    if (idx <= 0) {
        prevBtn.style.display = 'none';
    } else {
        prevBtn.style.display = 'flex';
    }

    if (idx >= state.filteredScreenshots.length - 1) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = 'flex';
    }
}

export function nextImage() {
    const idx = state.filteredScreenshots.findIndex(item => {
        const url = typeof item === 'string' ? item : item.url;
        return url === state.currentModalUrl;
    });
    if (idx !== -1 && idx < state.filteredScreenshots.length - 1) {
        const nextItem = state.filteredScreenshots[idx + 1];
        state.currentModalUrl = typeof nextItem === 'string' ? nextItem : nextItem.url;
        updateModalImage();
    }
}

export function prevImage() {
    const idx = state.filteredScreenshots.findIndex(item => {
        const url = typeof item === 'string' ? item : item.url;
        return url === state.currentModalUrl;
    });
    if (idx > 0) {
        const prevItem = state.filteredScreenshots[idx - 1];
        state.currentModalUrl = typeof prevItem === 'string' ? prevItem : prevItem.url;
        updateModalImage();
    }
}

function preloadNeighbors(idx) {
    if (idx < state.filteredScreenshots.length - 1) {
        const nextItem = state.filteredScreenshots[idx + 1];
        const nextUrl = typeof nextItem === 'string' ? nextItem : nextItem.url;
        new Image().src = nextUrl;
    }
    if (idx > 0) {
        const prevItem = state.filteredScreenshots[idx - 1];
        const prevUrl = typeof prevItem === 'string' ? prevItem : prevItem.url;
        new Image().src = prevUrl;
    }
}

// Keyboard nav export for main.js
export function handleKeydown(e) {
    if (!state.isModalOpen) return;
    if (e.key === 'ArrowLeft') prevImage();
    if (e.key === 'ArrowRight') nextImage();
    if (e.key === 'Escape') closeModal();
    if (e.key === "1") setTag('PASS');
    if (e.key === "2") setTag('FAIL');
    if (e.key === "3") setTag('BLOCK');
}
