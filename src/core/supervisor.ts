import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const TEST_CMD = 'npx';
const TEST_ARGS = ['playwright', 'test', 'tests/golden_paths/main_flow.spec.ts', '--project=chromium'];
const CHECK_INTERVAL_MS = 60 * 1000; // Check status every minute
const WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes silence = hang
const RESTART_DELAY_MS = 10 * 1000; // Wait 10s before restart
const LOG_PATH = path.join(process.cwd(), 'output', 'supervisor.log');
const STATUS_PATH = path.join(process.cwd(), 'output', 'supervisor_status.json');

function writeStatus(status: string, task?: string) {
    const data: any = {
        status,
        timestamp: new Date().toISOString()
    };
    if (task) data.currentTask = task;

    fs.writeFileSync(STATUS_PATH, JSON.stringify(data));
}

function log(message: string) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    console.log(line.trim());
    fs.appendFileSync(LOG_PATH, line);
}

class Supervisor {
    private process: ChildProcess | null = null;
    private watchdogTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;

    constructor() {
        // Ensure output dir exists
        const outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    start() {
        log('Starting Supervisor...');

        // Initial Status
        writeStatus('IDLE (Initializing)');

        this.runProcess();

        // Periodic Liveness Check (Heartbeat)
        setInterval(() => {
            if (this.process && this.process.exitCode === null) {
                // Heartbeat doesn't need to overwrite status if running
            } else {
                writeStatus('IDLE (Waiting)');
            }
        }, CHECK_INTERVAL_MS);
    }

    private runProcess() {
        if (this.isShuttingDown) return;

        log(`Spawning process: ${TEST_CMD} ${TEST_ARGS.join(' ')}`);
        writeStatus('RUNNING');

        // Spawn with shell: true for npx compatibility
        this.process = spawn(TEST_CMD, TEST_ARGS, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true
        });

        // Reset Watchdog immediately upon start
        this.resetWatchdog();

        this.process.stdout?.on('data', (data) => {
            const output = data.toString().trim();
            // log(`[STDOUT] ${output.slice(0, 100)}...`); 

            // [ACTIVITY] Parsing
            if (output.includes('[ACTIVITY]')) {
                const activityMatch = output.match(/\[ACTIVITY\]\s*(.*)/);
                if (activityMatch) {
                    const task = activityMatch[1];
                    writeStatus('RUNNING', task);
                }
            }

            this.resetWatchdog();
        });

        this.process.stderr?.on('data', (data) => {
            log(`[STDERR] ${data.toString().trim()}`);
            this.resetWatchdog();
        });

        this.process.on('close', (code) => {
            log(`Process exited with code ${code}`);
            writeStatus(`STOPPED (Code ${code})`);
            this.cleanupWatchdog();

            // Auto-Restart Loop
            if (!this.isShuttingDown) {
                log(`Restarting in ${RESTART_DELAY_MS / 1000} seconds...`);
                writeStatus(`RESTARTING (Next run in ${RESTART_DELAY_MS / 1000}s)`);
                setTimeout(() => this.runProcess(), RESTART_DELAY_MS);
            }
        });

        this.process.on('error', (err) => {
            log(`Failed to start process: ${err.message}`);
            this.cleanupWatchdog();
            if (!this.isShuttingDown) {
                setTimeout(() => this.runProcess(), RESTART_DELAY_MS);
            }
        });
    }

    private resetWatchdog() {
        this.cleanupWatchdog();
        this.watchdogTimer = setTimeout(() => {
            log(`WATCHDOG TRIGGERED: No output for ${WATCHDOG_TIMEOUT_MS / 1000}s. Killing process.`);
            this.killProcess();
        }, WATCHDOG_TIMEOUT_MS);
    }

    private cleanupWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    private killProcess() {
        if (this.process) {
            // Using standard kill. If this fails to kill deep children, we might need 'tree-kill' later.
            // But for now, killing the npx wrapper usually propagates or breaks the pipe.
            this.process.kill('SIGKILL');
            log('Sent SIGKILL to process.');
        }
    }
}

// Start
const supervisor = new Supervisor();
supervisor.start();

// Handle self-termination
process.on('SIGINT', () => {
    log('Supervisor received SIGINT. Shutting down...');
    process.exit(0);
});
