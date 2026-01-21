/**
 * LearningWeightLoader
 * 
 * 분석 JSON에서 Imitation Learning 가중치를 로드하고
 * Scraper에서 사용할 수 있는 형태로 제공합니다.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PagePattern {
    page: string;
    actions: Array<{
        type: string;
        selector: string;
        label: string;
        page: string;
        value?: string;
    }>;
    actionSequence: string[];
}

export interface LearningAnalysis {
    sessionFile: string;
    analyzedAt: string;
    totalRawEvents: number;
    totalCompressedActions: number;
    pagePatterns: PagePattern[];
    actionFrequency: Record<string, number>;
    priorityWeights: Record<string, number>;
}

export interface LearningWeights {
    pagePatterns: PagePattern[];
    priorityWeights: Record<string, number>;
    actionFrequency: Record<string, number>;
}

export class LearningWeightLoader {
    /**
     * 분석 JSON 파일에서 학습 가중치를 로드합니다.
     */
    static load(analysisPath: string): LearningWeights {
        if (!fs.existsSync(analysisPath)) {
            throw new Error(`Analysis file not found: ${analysisPath}`);
        }

        const content = fs.readFileSync(analysisPath, 'utf-8');
        const analysis: LearningAnalysis = JSON.parse(content);

        return {
            pagePatterns: analysis.pagePatterns || [],
            priorityWeights: analysis.priorityWeights || {},
            actionFrequency: analysis.actionFrequency || {}
        };
    }

    /**
     * 가장 최신 분석 파일을 자동으로 찾아 로드합니다.
     */
    static loadLatest(learningDir: string): LearningWeights | null {
        const dir = path.resolve(learningDir);
        if (!fs.existsSync(dir)) {
            return null;
        }

        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith('analysis-') && f.endsWith('.json'))
            .sort()
            .reverse();

        if (files.length === 0) {
            return null;
        }

        return this.load(path.join(dir, files[0]));
    }

    /**
     * 요소 라벨에 대한 우선순위 가중치를 반환합니다.
     * 학습된 패턴에 없는 요소는 기본값 0.01을 반환합니다.
     */
    static getElementPriority(label: string, weights: LearningWeights): number {
        const key = `action:click:${label}`;
        return weights.priorityWeights[key] ?? 0.01;
    }

    /**
     * 현재 페이지에 해당하는 패턴을 찾습니다.
     */
    static getPagePattern(currentPath: string, weights: LearningWeights): PagePattern | null {
        return weights.pagePatterns.find(p => currentPath.includes(p.page)) || null;
    }

    /**
     * 요소 배열을 학습된 가중치로 정렬합니다.
     * 높은 가중치가 먼저 오도록 정렬합니다.
     */
    static sortByPriority<T extends { label?: string; text?: string }>(
        elements: T[],
        weights: LearningWeights
    ): T[] {
        return [...elements].sort((a, b) => {
            const labelA = a.label || a.text || '';
            const labelB = b.label || b.text || '';
            const weightA = this.getElementPriority(labelA, weights);
            const weightB = this.getElementPriority(labelB, weights);
            return weightB - weightA;
        });
    }
}
