export { };

import { RecordedAction } from '../index.js';

declare global {
    interface Window {
        // Recorder flags
        __antigravity_recorder?: boolean;
        antigravity_recordAction?: (data: RecordedAction) => void;

        // Scraper flags
        __discoveredRoutes?: Set<string>;
    }
}
