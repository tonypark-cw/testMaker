import { Page } from 'playwright';

export class RecoveryManager {
    private errorCount = 0;
    private readonly ERROR_THRESHOLD: number;

    constructor(threshold: number = 50) {
        this.ERROR_THRESHOLD = threshold;
    }

    /**
     * Check if error threshold is reached and reload page if necessary
     */
    async checkAndTriggerRecovery(page: Page): Promise<void> {
        this.errorCount++;

        if (this.errorCount >= this.ERROR_THRESHOLD) {
            console.log(`[RecoveryManager] ⚠️ Error threshold reached (${this.errorCount}). Reloading page to prevent crash...`);
            this.errorCount = 0;

            try {
                await page.reload({ waitUntil: 'domcontentloaded' });
                // Wait for stability after reload
                await page.waitForTimeout(3000);
                console.log('[RecoveryManager] ✓ Page reload successful. Resuming...');
            } catch (e) {
                console.log('[RecoveryManager] ❌ Reload failed (page might be closed).');
            }
        }
    }

    reset() {
        this.errorCount = 0;
    }
}
