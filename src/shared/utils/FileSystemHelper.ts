/**
 * File System Helper
 *
 * Provides centralized file system operations with consistent error handling.
 * Replaces scattered fs.existsSync/mkdirSync patterns across the codebase.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ErrorHandler, ErrorSeverity } from './ErrorHandler.js';

export class FileSystemHelper {
    /**
     * Ensure a directory exists, creating it if necessary
     */
    static ensureDir(dirPath: string): boolean {
        if (fs.existsSync(dirPath)) return true;

        return ErrorHandler.safeExecuteSync(
            () => {
                fs.mkdirSync(dirPath, { recursive: true });
                return true;
            },
            { component: 'FileSystemHelper', operation: 'ensureDir', data: { dirPath } },
            false,
            ErrorSeverity.WARNING
        );
    }

    /**
     * Ensure the parent directory of a file exists
     */
    static ensureDirForFile(filePath: string): boolean {
        const dir = path.dirname(filePath);
        return this.ensureDir(dir);
    }

    /**
     * Safely read and parse a JSON file
     */
    static safeReadJSON<T>(filePath: string, defaultValue: T): T {
        if (!fs.existsSync(filePath)) return defaultValue;

        return ErrorHandler.safeExecuteSync(
            () => JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T,
            { component: 'FileSystemHelper', operation: 'safeReadJSON', data: { filePath } },
            defaultValue,
            ErrorSeverity.WARNING
        );
    }

    /**
     * Safely write JSON to a file
     */
    static safeWriteJSON(filePath: string, data: unknown, pretty: boolean = true): boolean {
        this.ensureDirForFile(filePath);

        return ErrorHandler.safeExecuteSync(
            () => {
                const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
                fs.writeFileSync(filePath, content);
                return true;
            },
            { component: 'FileSystemHelper', operation: 'safeWriteJSON', data: { filePath } },
            false,
            ErrorSeverity.ERROR
        );
    }

    /**
     * Safely read a text file
     */
    static safeReadText(filePath: string, defaultValue: string = ''): string {
        if (!fs.existsSync(filePath)) return defaultValue;

        return ErrorHandler.safeExecuteSync(
            () => fs.readFileSync(filePath, 'utf-8'),
            { component: 'FileSystemHelper', operation: 'safeReadText', data: { filePath } },
            defaultValue,
            ErrorSeverity.WARNING
        );
    }

    /**
     * Safely write text to a file
     */
    static safeWriteText(filePath: string, content: string): boolean {
        this.ensureDirForFile(filePath);

        return ErrorHandler.safeExecuteSync(
            () => {
                fs.writeFileSync(filePath, content);
                return true;
            },
            { component: 'FileSystemHelper', operation: 'safeWriteText', data: { filePath } },
            false,
            ErrorSeverity.ERROR
        );
    }

    /**
     * Safely copy a file
     */
    static safeCopy(src: string, dest: string): boolean {
        if (!fs.existsSync(src)) return false;
        this.ensureDirForFile(dest);

        return ErrorHandler.safeExecuteSync(
            () => {
                fs.copyFileSync(src, dest);
                return true;
            },
            { component: 'FileSystemHelper', operation: 'safeCopy', data: { src, dest } },
            false,
            ErrorSeverity.ERROR
        );
    }

    /**
     * Safely delete a file
     */
    static safeDelete(filePath: string): boolean {
        if (!fs.existsSync(filePath)) return true;

        return ErrorHandler.safeExecuteSync(
            () => {
                fs.unlinkSync(filePath);
                return true;
            },
            { component: 'FileSystemHelper', operation: 'safeDelete', data: { filePath } },
            false,
            ErrorSeverity.WARNING
        );
    }

    /**
     * List files in a directory with optional filter
     */
    static listFiles(
        dirPath: string,
        filter?: (filename: string) => boolean
    ): string[] {
        if (!fs.existsSync(dirPath)) return [];

        return ErrorHandler.safeExecuteSync(
            () => {
                const files = fs.readdirSync(dirPath);
                return filter ? files.filter(filter) : files;
            },
            { component: 'FileSystemHelper', operation: 'listFiles', data: { dirPath } },
            [],
            ErrorSeverity.WARNING
        );
    }

    /**
     * Get file stats safely
     */
    static safeStats(filePath: string): fs.Stats | null {
        if (!fs.existsSync(filePath)) return null;

        return ErrorHandler.safeExecuteSync(
            () => fs.statSync(filePath),
            { component: 'FileSystemHelper', operation: 'safeStats', data: { filePath } },
            null,
            ErrorSeverity.SILENT
        );
    }

    /**
     * Check if path is a directory
     */
    static isDirectory(filePath: string): boolean {
        const stats = this.safeStats(filePath);
        return stats?.isDirectory() ?? false;
    }

    /**
     * Check if path is a file
     */
    static isFile(filePath: string): boolean {
        const stats = this.safeStats(filePath);
        return stats?.isFile() ?? false;
    }

    /**
     * Get file modification time
     */
    static getModifiedTime(filePath: string): Date | null {
        const stats = this.safeStats(filePath);
        return stats?.mtime ?? null;
    }

    /**
     * Find files recursively with depth limit
     */
    static findFilesRecursive(
        dirPath: string,
        pattern: RegExp,
        maxDepth: number = 5
    ): string[] {
        const results: string[] = [];

        const search = (currentPath: string, depth: number): void => {
            if (depth > maxDepth) return;
            if (!fs.existsSync(currentPath)) return;

            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        search(fullPath, depth + 1);
                    } else if (entry.isFile() && pattern.test(entry.name)) {
                        results.push(fullPath);
                    }
                }
            } catch {
                // Skip directories we can't read
            }
        };

        search(dirPath, 0);
        return results;
    }
}

export default FileSystemHelper;
