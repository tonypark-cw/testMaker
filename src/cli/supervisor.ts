import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
    SpawnAsyncOptions,
    SpawnAsyncResult,
    SpawnAsyncError,
    HealthCheckResults
} from './types.js';

async function spawnAsync(command: string, args: string[], options: SpawnAsyncOptions = {}): Promise<SpawnAsyncResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...options,
            shell: false,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => stdout += data.toString());
        child.stderr?.on('data', (data) => stderr += data.toString());

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                reject({ stdout, stderr, code, message: `Process exited with code ${code}` });
            }
        });

        child.on('error', (err) => {
            reject({ stdout, stderr, code: 1, message: err.message });
        });
    });
}

export class Supervisor {
    private watchDir: string;
    private outputDir: string;
    private isRunningChecks: boolean = false;
    /* eslint-disable no-undef */
    private debounceTimer: NodeJS.Timeout | null = null;
    /* eslint-enable no-undef */
    private statusPath: string;
    private supervisorPidPath: string;
    private workerPidPath: string;
    private triggerDir: string;
    private initialParentPid: number;

    constructor() {
        this.watchDir = path.join(process.cwd(), 'src');
        this.outputDir = path.join(process.cwd(), 'output');
        this.statusPath = path.join(this.outputDir, 'supervisor_status.json');
        this.supervisorPidPath = path.join(this.outputDir, 'supervisor.pid');
        this.workerPidPath = path.join(this.outputDir, 'worker.pid');
        this.triggerDir = path.join(process.cwd(), '.agent', 'triggers');

        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
        if (!fs.existsSync(this.triggerDir)) {
            fs.mkdirSync(this.triggerDir, { recursive: true });
        }
        this.initialParentPid = process.ppid;
    }

    public start() {
        console.log(`[Supervisor] 🛡️ Watchtower active. Guarding: ${this.watchDir}`);

        // Write PID for mutual monitoring
        fs.writeFileSync(this.supervisorPidPath, process.pid.toString());

        // Initial check
        this.triggerHealthCheck();

        // Recursive watch (Note: recursive is supported on Windows/macOS)
        fs.watch(this.watchDir, { recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('.ts') || filename.endsWith('.json'))) {
                this.debouncedCheck();
            }
        });

        // Periodic system monitoring: Every 30s check worker health
        setInterval(() => this.monitorSystemHealth(), 30000);

        // Auto-termination when Antigravity (parent) session ends
        this.startParentMonitor();
    }

    private startParentMonitor() {
        // Check every 10 seconds if the parent process is still alive.
        setInterval(() => {
            try {
                // signal 0 doesn't kill but checks if process exists
                process.kill(this.initialParentPid, 0);
            } catch {
                console.log('[Supervisor] 🏮 Antigravity session terminated. Shutting down Watchtower...');
                process.exit(0);
            }
        }, 10000);
    }

    private debouncedCheck() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.triggerHealthCheck();
        }, 3000); // 3s debounce
    }

    private async triggerHealthCheck() {
        if (this.isRunningChecks) return;
        this.isRunningChecks = true;

        console.log('\n[Supervisor] 🔍 Change detected. Running Health Gate...');

        const results: HealthCheckResults = {
            timestamp: new Date().toISOString(),
            lint: { status: 'pending', error: '' },
            tests: { status: 'pending', error: '' },
            overall: 'running'
        };
        this.updateStatus(results);

        try {
            const nodePath = process.execPath;
            const eslintPath = path.join(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js');
            const vitestPath = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

            // 1. Run Lint
            console.log('[Supervisor] 🧵 Checking Linting...');
            try {
                await spawnAsync(nodePath, [eslintPath, 'src/']);
                results.lint.status = 'pass';
            } catch (e) {
                const spawnError = e as SpawnAsyncError;
                results.lint.status = 'fail';
                results.lint.error = spawnError.stdout || spawnError.message;
                console.warn('[Supervisor] ❌ Linting failed.');
            }

            // 2. Run Unit Tests
            console.log('[Supervisor] 🧪 Running Unit Tests...');
            try {
                await spawnAsync(nodePath, [vitestPath, 'run']);
                results.tests.status = 'pass';
            } catch (e) {
                const spawnError = e as SpawnAsyncError;
                results.tests.status = 'fail';
                results.tests.error = spawnError.stdout || spawnError.message;
                console.warn('[Supervisor] ❌ Unit tests failed.');
            }

            results.overall = (results.lint.status === 'pass' && results.tests.status === 'pass') ? 'healthy' : 'degraded';

            if (results.overall === 'degraded') {
                this.generateDiagnosticReport(results);
            }

            console.log(`[Supervisor] ✅ Health Gate complete. Status: ${results.overall.toUpperCase()}`);

        } catch (globalError) {
            console.error('[Supervisor] 🚨 Critical error during health check:', globalError);
            results.overall = 'error';
        } finally {
            this.isRunningChecks = false;
            this.updateStatus(results);
        }
    }

    private monitorSystemHealth() {
        console.log('[Supervisor] 🏥 Checking system-wide sub-agent health...');

        // 1. Check Worker Health
        if (fs.existsSync(this.workerPidPath)) {
            try {
                const pid = parseInt(fs.readFileSync(this.workerPidPath, 'utf-8').trim(), 10);
                if (!isNaN(pid) && pid > 0) {
                    process.kill(pid, 0); // Check if alive
                    console.log(`[Supervisor] 👷 Worker (PID: ${pid}) is active.`);
                }
            } catch {
                console.warn('[Supervisor] ⚠️ Worker process died or is unreachable. Attempting resuscitation...');
                this.restartWorker();
            }
        } else {
            console.log('[Supervisor] ⚠️ Worker PID file not found. Starting worker...');
            this.restartWorker();
        }
    }

    private restartWorker() {
        console.log('[Supervisor] 🚀 Resuscitating Worker Agent...');
        const tsxPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
        const child = spawn('node', [tsxPath, 'src/dashboard/worker.ts'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            shell: false
        });
        child.unref();
        console.log('[Supervisor] ✅ Worker restart signal sent.');
    }

    private updateStatus(data: HealthCheckResults) {
        try {
            fs.writeFileSync(this.statusPath, JSON.stringify(data, null, 2));
        } catch {
            console.error('[Supervisor] Health check failed');
            return { status: 'fail', error: 'Unknown error' };
        }
    }

    private generateDiagnosticReport(healthResults: HealthCheckResults) {
        const reportPath = path.join(this.outputDir, 'diagnostic_report.json');
        const triggerPath = path.join(this.triggerDir, `analysis_needed_${Date.now()}.json`);

        const report = {
            id: `DIAG-${Date.now()}`,
            timestamp: new Date().toISOString(),
            summary: 'Automated diagnostic triggered by Supervisor due to Health Gate failure.',
            findings: healthResults,
            recommendation: 'Run analysis agent to investigate the failures.'
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        // Forced Trigger for Agent (Antigravity)
        fs.writeFileSync(triggerPath, JSON.stringify({
            trigger: 'HEALTH_GATE_FAILURE',
            severity: 'CRITICAL',
            context: report
        }, null, 2));

        console.log(`[Supervisor] 📝 Diagnostic Report generated: ${reportPath}`);
        console.log(`[Supervisor] 🔔 Agent trigger created: ${triggerPath}`);
    }
}

// Start if executed directly
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1].includes('supervisor.ts')) {
    const supervisor = new Supervisor();
    supervisor.start();
}
