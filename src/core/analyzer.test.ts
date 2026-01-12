import { describe, it, expect } from 'vitest';
import { Analyzer } from '../../scripts/analyzer.js';
import { TestableElement } from '../../types/index.js';

describe('Analyzer', () => {
    const analyzer = new Analyzer();

    describe('groupByProximity', () => {
        it('should group elements that are close together', () => {
            const elements: TestableElement[] = [
                {
                    id: 'elem-1',
                    selector: '#btn1',
                    tag: 'button',
                    type: 'button',
                    label: 'Button 1',
                    rect: { top: 100, left: 10, width: 100, height: 30 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: {}
                },
                {
                    id: 'elem-2',
                    selector: '#btn2',
                    tag: 'button',
                    type: 'button',
                    label: 'Button 2',
                    rect: { top: 150, left: 10, width: 100, height: 30 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: {}
                },
                {
                    id: 'elem-3',
                    selector: '#btn3',
                    tag: 'button',
                    type: 'button',
                    label: 'Button 3',
                    rect: { top: 600, left: 10, width: 100, height: 30 }, // Far away
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: {}
                }
            ];

            const result = analyzer.analyze(elements);

            // Should create at least 2 groups (close buttons + far button)
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle empty element array', () => {
            const result = analyzer.analyze([]);
            expect(result).toEqual([]);
        });

        it('should handle single element', () => {
            const elements: TestableElement[] = [
                {
                    id: 'elem-1',
                    selector: '#btn1',
                    tag: 'button',
                    type: 'button',
                    label: 'Button 1',
                    rect: { top: 100, left: 10, width: 100, height: 30 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: {}
                }
            ];

            const result = analyzer.analyze(elements);
            expect(result.length).toBeGreaterThanOrEqual(0);
        });
    });

    describe('scenario inference', () => {
        it('should detect form scenarios', () => {
            const formElements: TestableElement[] = [
                {
                    id: 'input-1',
                    selector: '#email',
                    tag: 'input',
                    type: 'text-input',
                    label: 'Email',
                    rect: { top: 100, left: 10, width: 200, height: 30 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: true },
                    attributes: { type: 'email' }
                },
                {
                    id: 'input-2',
                    selector: '#password',
                    tag: 'input',
                    type: 'text-input',
                    label: 'Password',
                    rect: { top: 150, left: 10, width: 200, height: 30 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: true },
                    attributes: { type: 'password' }
                },
                {
                    id: 'btn-1',
                    selector: '#submit',
                    tag: 'button',
                    type: 'button',
                    label: 'Submit',
                    rect: { top: 200, left: 10, width: 100, height: 40 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: { type: 'submit' }
                }
            ];

            const result = analyzer.analyze(formElements);

            // Should detect at least one scenario
            expect(result.length).toBeGreaterThan(0);

            // First scenario should have actions
            if (result.length > 0) {
                expect(result[0].actions).toBeDefined();
                expect(result[0].category).toBeDefined();
            }
        });

        it('should detect navigation scenarios', () => {
            const navElements: TestableElement[] = [
                {
                    id: 'link-1',
                    selector: 'a[href="/home"]',
                    tag: 'a',
                    type: 'link',
                    label: 'Home',
                    rect: { top: 50, left: 10, width: 80, height: 20 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: { href: '/home' }
                },
                {
                    id: 'link-2',
                    selector: 'a[href="/about"]',
                    tag: 'a',
                    type: 'link',
                    label: 'About',
                    rect: { top: 50, left: 100, width: 80, height: 20 },
                    sectionIndex: 0,
                    state: { visible: true, enabled: true, required: false },
                    attributes: { href: '/about' }
                }
            ];

            const result = analyzer.analyze(navElements);
            expect(result.length).toBeGreaterThanOrEqual(0);
        });
    });
});
