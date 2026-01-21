export interface BaselineData {
    url: string;
    domain: string;
    screenshotPath: string;
    screenshotHash: string;
    metadata: {
        timestamp: string;
        pageTitle: string;
        elementCount: number;
    };
    isGolden: boolean; // Trusted baseline
}

export interface VisualDiff {
    totalPixels: number;
    diffPixels: number;
    diffPercentage: number;
    status: 'PASS' | 'FAIL';
    diffImagePath?: string;
}

export interface RegressionResult {
    url: string;
    timestamp: string;
    visualDiff: VisualDiff;
    passed: boolean;
}

export interface BaselineIndex {
    domain: string;
    pages: Record<string, BaselineData>;
}
