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

/**
 * Apply DELETE tag to all selected images
 */
export async function applyDeleteToSelected() {
    if (state.selectedImages.size === 0) {
        alert('No images selected');
        return;
    }

    const count = state.selectedImages.size;
    if (!confirm(`Apply DELETE tag to ${count} image(s)?`)) {
        return;
    }

    let successCount = 0;
    for (const key of state.selectedImages) {
        const [url, hash] = key.split('#');
        try {
            await api.setTagDirect(url, 'DELETE', hash);
            successCount++;
        } catch (e) {
            console.error(`Failed to tag ${url}:`, e);
        }
    }

    alert(`DELETE tag applied to ${successCount}/${count} images`);
    clearSelection();

    // Refresh to show updated tags
    window.location.reload();
}

/**
 * Clear all selections
 */
export function clearSelection() {
    state.clearSelectedImages();
    updateSelectionUI();
    document.querySelectorAll('.card-checkbox').forEach(cb => cb.checked = false);
}
