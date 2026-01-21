/**
 * Centralized constants for the Scraper module.
 * Avoids magic numbers scattered across the codebase.
 */

// ============================================================
// TIMING CONSTANTS (milliseconds)
// ============================================================

export const TIMING = {
    /** Wait after UI cleanup operations */
    UI_CLEANUP_DELAY: 300,

    /** Wait for DOM stability check */
    DOM_STABILITY_WAIT: 800,

    /** Wait after filter/select interactions */
    FILTER_INTERACTION_DELAY: 500,

    /** Wait for menu animations */
    MENU_ANIMATION_DELAY: 1000,

    /** Wait after navigation actions */
    NAVIGATION_DELAY: 2000,

    /** Wait for page to fully render */
    FULL_RENDER_DELAY: 5000,

    /** Wait after page recovery/reload */
    RECOVERY_DELAY: 3000,

    /** Wait for dropdown to open */
    DROPDOWN_OPEN_DELAY: 200,

    /** Wait after auto-scroll step */
    SCROLL_STEP_DELAY: 500,

    /** Keyboard typing delay per character */
    TYPING_DELAY: 10,
} as const;

// ============================================================
// SAMPLING LIMITS
// ============================================================

export const LIMITS = {
    /** Maximum table rows to click per page */
    ROW_CLICK_SAMPLES: 5,

    /** Maximum select options to explore */
    SELECT_OPTION_SAMPLES: 3,

    /** Maximum checkboxes to explore */
    CHECKBOX_SAMPLES: 2,

    /** Maximum toggles to explore */
    TOGGLE_SAMPLES: 2,

    /** Maximum radio buttons to explore */
    RADIO_SAMPLES: 2,

    /** Maximum tabs to explore per page */
    TAB_SAMPLES: 10,

    /** Maximum pagination pages to explore */
    PAGINATION_SAMPLES: 3,

    /** Maximum global action buttons to click */
    GLOBAL_ACTION_SAMPLES: 5,

    /** Maximum sidebar buttons to explore */
    SIDEBAR_BUTTON_SAMPLES: 10,

    /** Maximum UUID pattern links to keep */
    UUID_LINK_SAMPLES: 500,

    /** Maximum RL history entries */
    RL_HISTORY_MAX: 2000,

    /** Maximum links to follow from "View All" */
    VIEW_ALL_LINK_LIMIT: 5,
} as const;

// ============================================================
// THRESHOLDS
// ============================================================

export const THRESHOLDS = {
    /** Minimum #root innerHTML length for stability */
    ROOT_CONTENT_MIN_LENGTH: 1000,

    /** Minimum body text length (below = blank page) */
    BODY_TEXT_MIN_LENGTH: 100,

    /** Maximum button text length for global actions */
    BUTTON_TEXT_MAX_LENGTH: 20,

    /** Maximum label length for ActionRecord */
    LABEL_MAX_LENGTH: 30,

    /** Maximum value length for ActionRecord */
    VALUE_MAX_LENGTH: 50,

    /** Vertical proximity for element grouping (px) */
    ELEMENT_GROUP_PROXIMITY: 400,

    /** Minimum links to classify as navigation scenario */
    NAVIGATION_LINK_MIN: 3,

    /** Error count threshold for page recovery */
    ERROR_THRESHOLD: 50,
} as const;

// ============================================================
// DOMAIN KEYWORDS (for menu expansion, filtering, etc.)
// ============================================================

export const KEYWORDS = {
    /** Known navigation menu headers */
    NAV_MENU_HEADERS: [
        'Inventory',
        'Manufacturing',
        'Sales',
        'Purchase',
        'Accounting',
        'Reports',
        'Settings',
        'Admin',
    ],

    /** Keywords to exclude from link discovery */
    EXCLUDED_LINK_KEYWORDS: [
        'logout',
        'signout',
        'sign-out',
        'delete',
        'remove',
        'cancel',
    ],

    /** Patterns indicating a "View All" type button */
    VIEW_ALL_PATTERNS: [
        'View All',
        'See All',
        'Show All',
        'More',
        '전체보기',
        '더보기',
    ],

    /** Loading spinner selectors */
    LOADING_SELECTORS: [
        '.mantine-Loader-root',
        '.loading',
        '.spinner',
        '[data-loading="true"]',
    ],
} as const;

// ============================================================
// SELECTORS
// ============================================================

export const SELECTORS = {
    /** Root element for stability check */
    ROOT: '#root',

    /** Modal/Dialog containers */
    MODALS: [
        '.mantine-Modal-root',
        '[role="dialog"]',
        '.modal',
        '.dialog',
    ],

    /** Sidebar navigation */
    SIDEBAR: '.mantine-AppShell-navbar',

    /** Expandable menu buttons */
    EXPANDABLE_MENUS: '[aria-expanded="false"]',

    /** Tab panels */
    TAB_PANELS: '[role="tablist"] [role="tab"]',

    /** Table rows (clickable) */
    TABLE_ROWS: 'tbody tr',

    /** Pagination controls */
    PAGINATION: '.mantine-Pagination-control',
} as const;

// ============================================================
// RETRY CONFIGURATION
// ============================================================

export const RETRY = {
    /** Default max retries for CommandExecutor */
    MAX_RETRIES: 3,

    /** Default delay between retries (ms) */
    RETRY_DELAY: 500,

    /** Token refresh retry count */
    TOKEN_REFRESH_RETRIES: 3,

    /** Rate limit base delay (seconds) */
    RATE_LIMIT_BASE_DELAY: 30,

    /** Rate limit max delay (seconds) */
    RATE_LIMIT_MAX_DELAY: 1800,

    /** Success count to reset rate limit */
    RATE_LIMIT_RESET_COUNT: 10,
} as const;

// ============================================================
// EXPORT ALL
// ============================================================

export const SCRAPER_CONFIG = {
    TIMING,
    LIMITS,
    THRESHOLDS,
    KEYWORDS,
    SELECTORS,
    RETRY,
} as const;

export default SCRAPER_CONFIG;
