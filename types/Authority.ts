export enum AuthorityLevel {
    /**
     * Critical operations that must succeed. Failure terminates the process.
     * Examples: Authentication, Navigation to Base URL, Crash Recovery.
     */
    CRITICAL = 30,

    /**
     * High priority operations. Significant impact if skipped.
     * Examples: Form Submission, Primary Content Capture.
     */
    HIGH = 20,

    /**
     * Standard operations.
     * Examples: Screenshot capturing, Text extraction.
     */
    NORMAL = 10,

    /**
     * Low priority / Optional operations. Can be skipped on error.
     * Examples: Analytics tracking, Optimization measurements.
     */
    LOW = 0
}
