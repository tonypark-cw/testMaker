/**
 * Dashboard History Module
 * Browser History API management for SPA-like navigation
 */

import * as state from './state.js';

/**
 * Push a new state to browser history
 */
export function pushState(stateObj, title = '') {
    const url = buildUrlFromState(stateObj);
    history.pushState(stateObj, title, url);
}

/**
 * Replace current state without adding to history
 */
export function replaceState(stateObj, title = '') {
    const url = buildUrlFromState(stateObj);
    history.replaceState(stateObj, title, url);
}

/**
 * Build URL from state object
 */
function buildUrlFromState(stateObj) {
    const params = new URLSearchParams();

    if (stateObj.env && stateObj.env !== 'stage') {
        params.set('env', stateObj.env);
    }
    if (stateObj.filter && stateObj.filter !== 'ALL') {
        params.set('filter', stateObj.filter);
    }
    if (stateObj.status && stateObj.status !== 'ALL') {
        params.set('status', stateObj.status);
    }
    if (stateObj.modal) {
        params.set('modal', encodeURIComponent(stateObj.modal));
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : window.location.pathname;
}

/**
 * Parse current URL to extract state
 */
export function parseUrlState() {
    const params = new URLSearchParams(window.location.search);
    return {
        env: params.get('env') || 'stage',
        filter: params.get('filter') || 'ALL',
        status: params.get('status') || 'ALL',
        modal: params.get('modal') ? decodeURIComponent(params.get('modal')) : null
    };
}

/**
 * Get current state for history
 */
export function getCurrentState() {
    return {
        env: state.currentEnvironment,
        filter: state.currentFilter,
        status: state.currentStatusFilter,
        modal: state.isModalOpen ? state.currentWebUrl : null
    };
}

/**
 * Initialize history from URL on page load
 */
export function initFromUrl(handlers) {
    const urlState = parseUrlState();

    // Set initial state without pushing to history
    if (urlState.env !== 'stage') {
        handlers.switchEnvironment?.(urlState.env);
    }
    if (urlState.filter !== 'ALL') {
        handlers.setFilter?.(urlState.filter);
    }
    if (urlState.status !== 'ALL') {
        handlers.setStatusFilter?.(urlState.status);
    }

    // Store initial state
    replaceState(urlState);

    // Return modal URL to open after data loads
    return urlState.modal;
}

/**
 * Setup popstate listener for back/forward navigation
 */
export function setupPopStateListener(handlers) {
    window.addEventListener('popstate', (event) => {
        const prevState = event.state || parseUrlState();
        console.log('[History] Popstate:', prevState);

        // Handle modal state
        if (prevState.modal) {
            // Find and open the modal
            const shot = state.filteredScreenshots.find(s =>
                (s.webUrl || s.url) === prevState.modal
            );
            if (shot) {
                handlers.openModalWithoutHistory?.(shot.url, shot.hash, shot.webUrl || shot.url);
            }
        } else if (state.isModalOpen) {
            // Close modal if going back from modal state
            handlers.closeModalWithoutHistory?.();
        }

        // Handle environment change
        if (prevState.env && prevState.env !== state.currentEnvironment) {
            handlers.switchEnvironmentWithoutHistory?.(prevState.env);
        }

        // Handle filter changes
        if (prevState.filter !== state.currentFilter) {
            handlers.setFilterWithoutHistory?.(prevState.filter || 'ALL');
        }
        if (prevState.status !== state.currentStatusFilter) {
            handlers.setStatusFilterWithoutHistory?.(prevState.status || 'ALL');
        }
    });
}
