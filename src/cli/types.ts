/**
 * CLI Command Types
 *
 * Provides type-safe interfaces for CLI command options.
 * Replaces `any` types with proper type definitions.
 */

import { SpawnOptions } from 'child_process';

/**
 * Options for the record command
 */
export interface RecordOptions {
    url?: string;
    outputDir?: string;
}

/**
 * Options for the search command
 */
export interface SearchOptions {
    url?: string;
    outputDir?: string;
    limit?: string;
    depth?: string;
    epochs?: string;
    concurrency?: string;
    headless?: boolean;
    force?: boolean;
    username?: string;
    password?: string;
    quiet?: boolean;
    resume?: boolean;
}

/**
 * Options for spawn async operations
 */
export interface SpawnAsyncOptions extends Omit<SpawnOptions, 'shell' | 'windowsHide'> {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
}

/**
 * Result from spawn async operations
 */
export interface SpawnAsyncResult {
    stdout: string;
    stderr: string;
    code: number;
}

/**
 * Error from spawn async operations
 */
export interface SpawnAsyncError extends SpawnAsyncResult {
    message: string;
}

/**
 * Health check status for a single check
 */
export interface HealthCheckStatus {
    status: 'pending' | 'pass' | 'fail';
    error: string;
}

/**
 * Health check results from supervisor
 */
export interface HealthCheckResults {
    timestamp: string;
    lint: HealthCheckStatus;
    tests: HealthCheckStatus;
    overall: 'running' | 'healthy' | 'degraded' | 'error';
}

/**
 * Job received from dashboard
 */
export interface WorkerJob {
    url: string;
    depth?: number;
    limit?: number;
    id?: string;
}

/**
 * Diagnostic report from supervisor
 */
export interface DiagnosticReport {
    id: string;
    timestamp: string;
    summary: string;
    findings: HealthCheckResults;
    recommendation: string;
}

/**
 * Agent trigger data
 */
export interface AgentTrigger {
    trigger: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    context: DiagnosticReport;
}
