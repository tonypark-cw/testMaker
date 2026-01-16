/**
 * Dashboard API Module
 * API communication functions
 */

import * as state from './state.js';

/**
 * Start a new search
 */
export async function startSearch() {
    const url = state.inputUrl.value;
    if (!url) return alert('Please enter a URL');

    console.log(`[UI] Requesting analysis for: ${url}`);
    state.btnStart.classList.add('btn-disabled');
    state.runnerStatus.innerText = "Starting...";

    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            body: JSON.stringify({ url, depth: 5 })
        });
        const json = await res.json();
        console.log(`[UI] Server Response:`, json);
        if (json.error) alert(json.error);
    } catch (e) {
        console.error(`[UI] Fetch Error:`, e);
        alert('Failed to start: ' + e);
    }
}

/**
 * Stop the current search
 */
export async function stopSearch() {
    if (!confirm('Are you sure you want to stop the analysis?')) return;
    try {
        await fetch('/api/stop', { method: 'POST' });
    } catch (e) { }
}

/**
 * Re-search all failed items
 */
export async function researchFailures() {
    const failUrls = Object.entries(state.tags)
        .filter(([url, status]) => status === 'FAIL')
        .map(([url]) => url);

    if (failUrls.length === 0) return alert('No FAIL items to re-search.');
    if (!confirm(`Queue re-analysis for ${failUrls.length} failed pages?`)) return;

    state.btnStart.classList.add('btn-disabled');
    state.runnerStatus.innerText = "Queueing...";

    let queuedCount = 0;
    for (const failShotPath of failUrls) {
        const shot = state.serverScreenshots.find(s => s.url === failShotPath);
        const originalUrl = shot ? shot.webUrl : null;

        if (!originalUrl) {
            console.error(`Skipping ${failShotPath} - Unknown Web URL`);
            continue;
        }

        try {
            await fetch('/api/search', {
                method: 'POST',
                body: JSON.stringify({ url: originalUrl, depth: 4, limit: 50 })
            });
            queuedCount++;
        } catch (e) { console.error(e); }
    }
    alert(`Queued ${queuedCount} pages for re-analysis.`);
}

/**
 * Set a tag for the current modal item
 */
export async function setTag(status, nextImageFn) {
    if (!state.currentModalUrl || !state.currentWebUrl) return;

    const key = state.currentModalHash ? `${state.currentWebUrl}#${state.currentModalHash}` : state.currentWebUrl;
    state.tags[key] = status;

    try {
        await fetch('/api/tag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: state.currentWebUrl, status, hash: state.currentModalHash })
        });
    } catch (e) { }

    // Auto-advance after tagging
    if (nextImageFn) {
        setTimeout(() => nextImageFn(), 300);
    }
}

/**
 * Save failure reason
 */
export async function saveReason() {
    const reason = document.getElementById('fail-reason').value;
    const statusEl = document.getElementById('reason-status');

    const key = state.currentModalHash ? `${state.currentWebUrl}#${state.currentModalHash}` : state.currentWebUrl;
    state.reasons[key] = reason;
    statusEl.innerText = 'Saving...';

    try {
        await fetch('/api/reason', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: state.currentWebUrl, reason, hash: state.currentModalHash })
        });
        statusEl.innerText = 'Saved!';
        setTimeout(() => statusEl.innerText = '', 2000);
    } catch (e) {
        statusEl.innerText = 'Error saving';
    }
}
