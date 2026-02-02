/**
 * Dashboard Selection Module
 * Multi-select mode functions
 */

import * as state from './state.js';
import * as api from './api.js';

/**
 * Toggle selection mode on/off
 */
export function toggleSelectionMode() {
    state.setIsSelectionMode(!state.isSelectionMode);
    updateSelectionUI();
}

/**
 * Update UI based on selection mode
 */
export function updateSelectionUI() {
    const toggleBtn = document.getElementById('btn-toggle-select');
    const selectionActions = document.getElementById('selection-actions');
    const checkboxes = document.querySelectorAll('.card-checkbox');

    if (state.isSelectionMode) {
        toggleBtn.style.background = '#8b5cf6';
        toggleBtn.innerText = '✓ Selection Mode ON';
        selectionActions.style.display = 'flex';
        checkboxes.forEach(cb => cb.style.display = 'block');
    } else {
        toggleBtn.style.background = '#6366f1';
        toggleBtn.innerText = '📋 Selection Mode';
        selectionActions.style.display = 'none';
        checkboxes.forEach(cb => {
            cb.style.display = 'none';
            cb.checked = false;
        });
        state.clearSelectedImages();
    }

    // Update count
    document.getElementById('selected-count').innerText = `${state.selectedImages.size} selected`;
}

// In index.html, update the buttons to call applyTagToSelected('STATUS')
// This file (selection.js) changes:

/**
 * Apply a tag to all selected images
 */
export async function applyTagToSelected(status) {
    if (state.selectedImages.size === 0) {
        alert('No images selected');
        return;
    }

    const count = state.selectedImages.size;

    // For critical actions, confirm
    if (status === 'DELETE' && !confirm(`Apply DELETE tag to ${count} image(s)?`)) {
        return;
    }

    let successCount = 0;
    for (const key of state.selectedImages) {
        const [url, hash] = key.split('#');
        try {
            await api.setTagDirect(url, status, hash);
            successCount++;
        } catch (e) {
            console.error(`Failed to tag ${url}:`, e);
        }
    }

    alert(`${status} tag applied to ${successCount}/${count} images`);
    clearSelection();

    // Reload or refresh UI to show updated tags
    // For PASS/FAIL/BLOCK we can just refresh visuals without reload
    if (status === 'DELETE') {
        window.location.reload();
    } else {
        // Fetch latest tags to ensure hydration
        const res = await fetch(`${state.API_URL}?env=${state.currentEnvironment}`);
        const data = await res.json();
        state.setTags(data.tags || {});

        // Update UI
        import('./gallery.js').then(g => g.updateVisibleTags());
    }
}

/**
 * Clear all selections
 */
export function clearSelection() {
    state.clearSelectedImages();
    updateSelectionUI();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
}
