/**
 * JSON Validator
 *
 * Provides safe JSON parsing with optional schema validation.
 * Uses a lightweight validation approach without external dependencies.
 */

import * as fs from 'fs';
import { ErrorHandler, ErrorSeverity, ErrorContext } from './ErrorHandler.js';

/**
 * Simple type validator function
 */
export type Validator<T> = (value: unknown) => value is T;

/**
 * Validation result
 */
export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * Built-in validators for common types
 */
export const Validators = {
    string: (value: unknown): value is string => typeof value === 'string',
    number: (value: unknown): value is number => typeof value === 'number' && !isNaN(value),
    boolean: (value: unknown): value is boolean => typeof value === 'boolean',
    array: <T>(itemValidator?: Validator<T>) => (value: unknown): value is T[] => {
        if (!Array.isArray(value)) return false;
        if (itemValidator) {
            return value.every(item => itemValidator(item));
        }
        return true;
    },
    object: (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value),
    optional: <T>(validator: Validator<T>) => (value: unknown): value is T | undefined =>
        value === undefined || validator(value),
    nullable: <T>(validator: Validator<T>) => (value: unknown): value is T | null =>
        value === null || validator(value),
};

/**
 * Create a validator for an object shape
 */
export function createObjectValidator<T extends Record<string, unknown>>(
    shape: { [K in keyof T]: Validator<T[K]> }
): Validator<T> {
    return (value: unknown): value is T => {
        if (!Validators.object(value)) return false;
        for (const key of Object.keys(shape)) {
            if (!shape[key as keyof T](value[key])) {
                return false;
            }
        }
        return true;
    };
}

export class JsonValidator {
    /**
     * Parse JSON string safely
     */
    static parse<T = unknown>(
        jsonString: string,
        context?: string,
        validator?: Validator<T>
    ): ValidationResult<T> {
        const errorContext: ErrorContext = {
            component: 'JsonValidator',
            operation: 'parse',
            data: context ? { context } : undefined
        };

        try {
            const parsed = JSON.parse(jsonString);

            if (validator && !validator(parsed)) {
                return {
                    success: false,
                    error: 'Validation failed: data does not match expected shape'
                };
            }

            return { success: true, data: parsed as T };
        } catch (error) {
            const err = ErrorHandler.handle(error, errorContext, ErrorSeverity.WARNING);
            return { success: false, error: err.message };
        }
    }

    /**
     * Parse JSON file safely
     */
    static parseFile<T = unknown>(
        filePath: string,
        validator?: Validator<T>,
        defaultValue?: T
    ): T | null {
        if (!fs.existsSync(filePath)) {
            return defaultValue ?? null;
        }

        const errorContext: ErrorContext = {
            component: 'JsonValidator',
            operation: 'parseFile',
            data: { filePath }
        };

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const result = this.parse<T>(content, filePath, validator);

            if (result.success && result.data !== undefined) {
                return result.data;
            }

            if (result.error) {
                ErrorHandler.handle(
                    new Error(result.error),
                    errorContext,
                    ErrorSeverity.WARNING
                );
            }

            return defaultValue ?? null;
        } catch (error) {
            ErrorHandler.handle(error, errorContext, ErrorSeverity.WARNING);
            return defaultValue ?? null;
        }
    }

    /**
     * Stringify with error handling
     */
    static stringify(
        data: unknown,
        pretty: boolean = true,
        context?: string
    ): string | null {
        const errorContext: ErrorContext = {
            component: 'JsonValidator',
            operation: 'stringify',
            data: context ? { context } : undefined
        };

        try {
            return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        } catch (error) {
            ErrorHandler.handle(error, errorContext, ErrorSeverity.ERROR);
            return null;
        }
    }

    /**
     * Deep clone an object via JSON
     */
    static deepClone<T>(data: T): T | null {
        const str = this.stringify(data, false);
        if (!str) return null;

        const result = this.parse<T>(str);
        return result.success ? result.data ?? null : null;
    }

    /**
     * Merge objects deeply
     */
    static deepMerge<T extends Record<string, unknown>>(
        target: T,
        source: Partial<T>
    ): T {
        const result = { ...target };

        for (const key of Object.keys(source) as Array<keyof T>) {
            const sourceValue = source[key];
            const targetValue = result[key];

            if (
                Validators.object(sourceValue) &&
                Validators.object(targetValue) &&
                !Array.isArray(sourceValue)
            ) {
                result[key] = this.deepMerge(
                    targetValue as Record<string, unknown>,
                    sourceValue as Record<string, unknown>
                ) as T[keyof T];
            } else if (sourceValue !== undefined) {
                result[key] = sourceValue as T[keyof T];
            }
        }

        return result;
    }

    /**
     * Check if two values are deeply equal
     */
    static deepEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (a === null || b === null) return a === b;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            return a.every((item, index) => this.deepEqual(item, b[index]));
        }

        if (Validators.object(a) && Validators.object(b)) {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            return keysA.every(key => this.deepEqual(a[key], b[key]));
        }

        return false;
    }
}

export default JsonValidator;
