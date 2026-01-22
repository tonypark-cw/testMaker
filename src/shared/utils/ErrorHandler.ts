/**
 * Centralized Error Handler
 *
 * Provides consistent error handling patterns across the codebase.
 * Replaces scattered try-catch blocks with standardized severity levels.
 */

export enum ErrorSeverity {
    /** No logging - for non-critical optional operations */
    SILENT = 'silent',
    /** Warning only - for recoverable failures */
    WARNING = 'warning',
    /** Error logging - for significant failures with recovery */
    ERROR = 'error',
    /** Critical - re-throws after logging */
    CRITICAL = 'critical'
}

export interface ErrorContext {
    /** Component or function name */
    component: string;
    /** Operation being performed */
    operation?: string;
    /** Additional context data */
    data?: Record<string, unknown>;
}

/**
 * Standardized error information
 */
export interface ErrorInfo {
    message: string;
    stack?: string;
    code?: string;
    context: ErrorContext;
    timestamp: string;
}

export class ErrorHandler {
    private static formatContext(ctx: ErrorContext): string {
        const parts = [ctx.component];
        if (ctx.operation) parts.push(ctx.operation);
        return `[${parts.join('.')}]`;
    }

    /**
     * Handle an error with specified severity
     */
    static handle(
        error: unknown,
        context: ErrorContext,
        severity: ErrorSeverity = ErrorSeverity.ERROR
    ): ErrorInfo {
        const err = error instanceof Error ? error : new Error(String(error));
        const prefix = this.formatContext(context);

        const errorInfo: ErrorInfo = {
            message: err.message,
            stack: err.stack,
            context,
            timestamp: new Date().toISOString()
        };

        switch (severity) {
            case ErrorSeverity.SILENT:
                // No logging
                break;

            case ErrorSeverity.WARNING:
                console.warn(`${prefix} Warning: ${err.message}`);
                break;

            case ErrorSeverity.ERROR:
                console.error(`${prefix} Error: ${err.message}`);
                if (context.data) {
                    console.error(`${prefix} Context:`, context.data);
                }
                break;

            case ErrorSeverity.CRITICAL:
                console.error(`${prefix} CRITICAL: ${err.message}`);
                console.error(`${prefix} Stack:`, err.stack);
                if (context.data) {
                    console.error(`${prefix} Context:`, context.data);
                }
                throw err;
        }

        return errorInfo;
    }

    /**
     * Safely execute an async function with error handling
     */
    static async safeExecute<T>(
        fn: () => Promise<T>,
        context: ErrorContext,
        defaultValue: T,
        severity: ErrorSeverity = ErrorSeverity.ERROR
    ): Promise<T> {
        try {
            return await fn();
        } catch (error) {
            this.handle(error, context, severity);
            return defaultValue;
        }
    }

    /**
     * Safely execute a sync function with error handling
     */
    static safeExecuteSync<T>(
        fn: () => T,
        context: ErrorContext,
        defaultValue: T,
        severity: ErrorSeverity = ErrorSeverity.ERROR
    ): T {
        try {
            return fn();
        } catch (error) {
            this.handle(error, context, severity);
            return defaultValue;
        }
    }

    /**
     * Create a wrapped async function with automatic error handling
     */
    static wrap<TArgs extends unknown[], TReturn>(
        fn: (...args: TArgs) => Promise<TReturn>,
        context: ErrorContext,
        severity: ErrorSeverity = ErrorSeverity.ERROR
    ): (...args: TArgs) => Promise<TReturn | undefined> {
        return async (...args: TArgs): Promise<TReturn | undefined> => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handle(error, context, severity);
                return undefined;
            }
        };
    }

    /**
     * Assert a condition or throw with context
     */
    static assert(
        condition: boolean,
        message: string,
        context: ErrorContext
    ): asserts condition {
        if (!condition) {
            const error = new Error(message);
            this.handle(error, context, ErrorSeverity.CRITICAL);
        }
    }
}

export default ErrorHandler;
