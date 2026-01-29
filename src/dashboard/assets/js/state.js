/**
 * Dashboard State Module
 * Shared state variables for the dashboard
 */

// Environment
export let currentEnvironment = 'stage';
export const API_URL = '/api/stats';

// Data State
export let serverScreenshots = [];
export let filteredScreenshots = [];
export let visualScreenshots = [];
export let tags = {};
export let reasons = {};

// UI State
export let currentModalUrl = null;
export let currentModalHash = null;
export let currentWebUrl = null;
export let isModalOpen = false;
export let currentFilter = 'ALL';
export let currentStatusFilter = 'ALL';
export let currentDateFilter = 'ALL'; // Date filter state
export let isRunning = false;
export let queueLength = 0;
export let lastScanTime = 0;
export let scrollObserver = null;

// Selection Mode State
export let isSelectionMode = false;
export let selectedImages = new Set(); // URLs of selected images
export let lastSelectedUrl = null; // For shift-click range selection

// Constants
export const BATCH_SIZE = 24;

// State Setters (for external modules to update state)
export function setCurrentEnvironment(env) { currentEnvironment = env; }
export function setServerScreenshots(data) { serverScreenshots = data; }
export function setFilteredScreenshots(data) { filteredScreenshots = data; }
export function setVisualScreenshots(data) { visualScreenshots = data; }
export function setTags(data) { tags = data; }
export function setReasons(data) { reasons = data; }
export function setCurrentModalUrl(url) { currentModalUrl = url; }
export function setCurrentModalHash(hash) { currentModalHash = hash; }
export function setCurrentWebUrl(url) { currentWebUrl = url; }
export function setIsModalOpen(open) { isModalOpen = open; }
export function setCurrentFilter(filter) { currentFilter = filter; }
export function setCurrentStatusFilter(filter) { currentStatusFilter = filter; }
export function setCurrentDateFilter(date) { currentDateFilter = date; }
export function setIsRunning(running) { isRunning = running; }
export function setQueueLength(length) { queueLength = length; }
export function setLastScanTime(time) { lastScanTime = time; }
export function setScrollObserver(observer) { scrollObserver = observer; }
export function setIsSelectionMode(mode) { isSelectionMode = mode; }
export function toggleImageSelection(url) {
    if (selectedImages.has(url)) {
        selectedImages.delete(url);
    } else {
        selectedImages.add(url);
    }
    lastSelectedUrl = url;
}
export function setLastSelectedUrl(url) { lastSelectedUrl = url; }
export function addImageSelection(url) { selectedImages.add(url); }
export function clearSelectedImages() { selectedImages.clear(); }

// DOM Elements (initialized after DOM ready)
export let gallery, loading, sentinel, btnStart, btnStop, inputUrl, runnerStatus;

export function initDOMElements() {
    gallery = document.getElementById('gallery');
    loading = document.getElementById('loading');
    sentinel = document.getElementById('sentinel');
    btnStart = document.getElementById('btn-start');
    btnStop = document.getElementById('btn-stop');
    inputUrl = document.getElementById('target-url');
    runnerStatus = document.getElementById('runner-status');
}
