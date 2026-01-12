
import { state } from './state.js';
import { fetchStats, startAnalysis, stopAnalysis } from './api.js';
import { loadMore, createCard, getScreenshotType, applyFilterAndReset, setFilter, updateVisibleTags, isGolden } from './gallery.js';
import { closeModal, nextImage, prevImage, setTag, handleKeydown, updateModalNav } from './modal.js';

// DOM Elements
const btnStart = document.getElementById('btn-start');
const btnStop = document.getElementById('btn-stop');
const inputUrl = document.getElementById('target-url');
const runnerStatus = document.getElementById('runner-status');
const traceLink = document.getElementById('trace-link');

// Event Listeners (Replacements for inline onclick)
document.addEventListener('DOMContentLoaded', () => {
    // Runner
    btnStart.addEventListener('click', async () => {
        const url = inputUrl.value;
        if (!url) return alert('Please enter a URL');

        btnStart.classList.add('btn-disabled');
        runnerStatus.innerText = "Starting...";

        try {
            const json = await startAnalysis(url);
            if (json.error) alert(json.error);
        } catch (e) {
            alert('Failed to start: ' + e);
        }
    });

    btnStop.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to stop the analysis?')) return;
        try {
            await stopAnalysis();
        } catch (e) { }
    });

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setFilter(e.target.innerText);
        });
    });

    // Modal Controls
    document.querySelector('.back-btn').addEventListener('click', closeModal);
    document.querySelector('.close-icon').addEventListener('click', closeModal);
    document.querySelector('.prev-btn').addEventListener('click', prevImage);
    document.querySelector('.next-btn').addEventListener('click', nextImage);

    // QA Buttons
    document.querySelector('.btn-pass').addEventListener('click', () => setTag('PASS'));
    document.querySelector('.btn-fail').addEventListener('click', () => setTag('FAIL'));


    // Keyboard
    document.addEventListener('keydown', handleKeydown);

    // Infinite Scroll
    const sentinel = document.getElementById('sentinel');
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            loadMore();
        }
    });
    observer.observe(sentinel);

    // Date UI Listener - REMOVED (Date filter is now persistent)
    /*
    const shotCard = document.querySelector('.stat-card');
    const dateSelection = document.getElementById('date-selection');
    if (shotCard) {
        shotCard.style.cursor = 'pointer';
        shotCard.addEventListener('click', () => {
            const isHidden = dateSelection.style.display === 'none';
            dateSelection.style.display = isHidden ? 'flex' : 'none';
        });
    }
    */

    // Initial Loop
    update();
    setInterval(update, 3000);
});


async function update() {
    try {
        const data = await fetchStats();

        // Update Runner UI
        state.isRunning = data.isRunning;
        if (state.isRunning) {
            btnStart.style.display = 'none';
            btnStop.style.display = 'block';
            inputUrl.disabled = true;
            runnerStatus.innerText = "Running Analysis...";
            runnerStatus.className = "runner-status status-running";
        } else {
            btnStart.style.display = 'block';
            btnStop.style.display = 'none';
            inputUrl.disabled = false;
            runnerStatus.innerText = "Idle";
            runnerStatus.className = "runner-status";
        }

        // Update Supervisor Status Badge
        const supervisorBadge = document.getElementById('supervisor-status');
        if (data.supervisorStatus) {
            const statusStr = data.supervisorStatus.status;
            if (supervisorBadge) {
                supervisorBadge.innerText = statusStr;
                // Simplified class-based coloring if needed, but for now just text
                if (statusStr === 'RUNNING') supervisorBadge.style.color = '#4da6ff';
                else if (statusStr.includes('STOPPED') || statusStr.includes('COOLDOWN') || statusStr.includes('RESTARTING')) supervisorBadge.style.color = '#ff4d4d';
                else supervisorBadge.style.color = '#888';
            }
        }


        // Update Stats
        let gpCount = 0;
        if (data.screenshots) {
            gpCount = data.screenshots.filter(item => isGolden(item)).length;
        }
        const gpEl = document.getElementById('gp-count');
        if (gpEl) gpEl.innerText = gpCount;

        const expEl = document.getElementById('exp-count');
        if (expEl) expEl.innerText = data.screenshots.length;

        // Initial Tab Setup (Once we have data)
        if (!state.initialized && data.screenshots && data.screenshots.length > 0) {
            state.initialized = true;
            if (window.setTab) window.setTab('EXPLORATION');
        }

        if (data.latestTrace) {
            traceLink.href = data.latestTrace;
            traceLink.style.display = 'inline-block';
        }

        // Calculate Breakdown for Tooltip
        let breakdown = { verified: 0, general: 0, modal: 0, detail: 0 };
        data.screenshots.forEach(item => {
            const type = getScreenshotType(item);
            if (type === 'MODAL') breakdown.modal++;
            else if (type === 'DETAIL') breakdown.detail++;
            else breakdown.general++;
        });

        const tooltip = document.getElementById('stats-tooltip');
        if (tooltip) {
            tooltip.innerHTML = `
                <div><strong>Breakdown</strong></div>
                <div>Modal: ${breakdown.modal}</div>
                <div>Detail: ${breakdown.detail}</div>
                <div>General: ${breakdown.general}</div>
            `;
        }


        state.tags = data.tags || {};
        updateVisibleTags();

        // [DATE-BASED GROUPING]
        // 1. Update available dates UI (Dropdown)
        if (data.availableDates && data.availableDates.length > 0) {
            const dateSelect = document.getElementById('date-filter');

            // Re-render options if changed (or if empty)
            // We verify change by joining strings or checking length
            // For simplicity, let's just checking if options count matches 1 (default) + dates
            if (dateSelect && dateSelect.options.length !== (data.availableDates.length + 1)) {
                // Keep the first "Select Date..." or "All Dates" option? 
                // Let's make the first option "All Dates" effectively equal to clearing filter
                dateSelect.innerHTML = '<option value="">All Dates</option>';

                data.availableDates.forEach(date => {
                    const opt = document.createElement('option');
                    opt.value = date;
                    opt.innerText = date;
                    dateSelect.appendChild(opt);
                });

                // Attach change listener once (or re-attach, safer)
                dateSelect.onchange = (e) => {
                    state.currentDate = e.target.value || null; // empty string -> null
                    applyFilterAndReset();
                };
            }

            // AUTO-SELECT LOGIC based on Tab
            // If we are in Golden Tab and no date is selected, assume Latest
            if (state.currentTab === 'GOLDEN' && !state.currentDate) {
                state.currentDate = data.availableDates[0];
                if (dateSelect) dateSelect.value = state.currentDate;
            }
            // If we are in Exploration Tab, we default to "All" (null) if not set. 
            // Note: If user switches tabs, we might want to reset? 
            // Current 'setTab' in gallery.js handles simple string change. 
            // Let's hook into applying filters to respect this.

            // Sync Dropdown value to State
            if (dateSelect && state.currentDate) {
                dateSelect.value = state.currentDate;
            } else if (dateSelect) {
                dateSelect.value = "";
            }
        }

        // 2. Logic to update screenshots
        const gallery = document.getElementById('gallery');
        const loading = document.getElementById('loading');

        if (gallery) gallery.style.display = 'grid';
        if (gallery) gallery.style.display = 'grid';
        // if (loading) loading.style.display = 'block'; // Moved to gallery.js control

        // Prepare screenshots based on date filter
        let targetShots = [];
        if (state.currentDate && data.screenshotsByDate) {
            targetShots = data.screenshotsByDate[state.currentDate] || [];
        } else {
            // Flatten all
            targetShots = data.screenshots;
        }

        // Compare with current state to avoid excessive renders
        // We'll use length + first item check as a quick heuristic or JSON stringify
        if (JSON.stringify(state.serverScreenshots) !== JSON.stringify(targetShots)) {
            state.serverScreenshots = targetShots;
            applyFilterAndReset();
        }

        // if (state.isModalOpen) updateModalNav(); 
        // Note: updateModalNav is internal to modal.js and not exported directly for external call? 
        // Actually I exported it, so we can import it if needed, but modal.js usually handles its own state.
        // However, if filtering changes underneath, we might need a refresh. 
        // The original code called it. Let's make sure it's exported.

    } catch (e) {
        console.error("Dashboard update failed:", e);
    }
}

// About Modal Logic
const modalAbout = document.getElementById('modal-about');
const btnAbout = document.getElementById('btn-about');
const closeAbout = document.getElementById('close-about');

if (btnAbout && modalAbout && closeAbout) {
    btnAbout.addEventListener('click', () => {
        modalAbout.style.display = 'flex';
    });
    closeAbout.addEventListener('click', () => {
        modalAbout.style.display = 'none';
    });
    // Click outside to close
    modalAbout.addEventListener('click', (e) => {
        if (e.target === modalAbout) modalAbout.style.display = 'none';
    });
}

// Expose to window for inline onclick handlers
window.setFilter = setFilter;
