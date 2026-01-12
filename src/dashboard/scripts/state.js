
export const state = {
    serverScreenshots: [],
    filteredScreenshots: [],
    visualScreenshots: [],
    tags: {},
    currentModalUrl: null,
    isModalOpen: false,
    filters: {
        type: 'ALL',
        depth: 'ALL',
        qa: 'ALL',
        golden: false
    },
    availableDates: [],
    currentDate: null,
    currentTab: 'EXPLORATION',
    isRunning: false
};

export const BATCH_SIZE = 24;
