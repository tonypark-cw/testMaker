import { TestableElement, TestScenario, TestAction, ScenarioCategory, SCENARIO_HINTS, ActionType } from '../../types/index.js';

export class TransformerService {
    transform(elements: TestableElement[]): TestScenario[] {
        console.log(`[Transformer] Transforming ${elements.length} elements into scenarios...`);

        // 1. Group elements by section index (currently mostly 0, but prepared for future)
        // For now, let's group by proximity (e.g., elements within 300px of each other)
        const groups = this.groupByProximity(elements);

        // 2. Map groups to scenarios
        const scenarios: TestScenario[] = [];

        groups.forEach((group, index) => {
            const scenario = this.inferScenario(group, index);
            if (scenario) {
                scenarios.push(scenario);
            }
        });

        return scenarios;
    }

    private groupByProximity(elements: TestableElement[]): TestableElement[][] {
        const sorted = [...elements].sort((a, b) => a.rect.top - b.rect.top);
        const groups: TestableElement[][] = [];
        if (sorted.length === 0) return groups;

        let currentGroup: TestableElement[] = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];

            // If elements are close vertically (within 400px), group them
            if (curr.rect.top - (prev.rect.top + prev.rect.height) < 400) {
                currentGroup.push(curr);
            } else {
                groups.push(currentGroup);
                currentGroup = [curr];
            }
        }
        groups.push(currentGroup);
        return groups;
    }

    private inferScenario(group: TestableElement[], index: number): TestScenario | null {
        if (group.length === 0) return null;

        const category = this.guessCategory(group);
        const actions = this.generateActions(group);

        if (actions.length === 0) return null;

        const name = this.generateScenarioName(category, group, index);

        return {
            id: `sc-${index}`,
            name,
            category,
            description: `${category} scenario involving ${group.length} elements.`,
            actions,
            priority: this.guessPriority(category, group)
        };
    }

    private guessCategory(group: TestableElement[]): ScenarioCategory {
        const text = group.map(el => [el.tag, el.selector, el.label, el.id].join(' ').toLowerCase()).join(' ');

        for (const [category, hints] of Object.entries(SCENARIO_HINTS)) {
            if ((hints as string[]).some((hint: string) => text.includes(hint))) {
                return category as ScenarioCategory;
            }
        }

        // Heuristics
        const hasInput = group.some(el => el.type === 'text-input' || el.type === 'textarea');
        const hasButton = group.some(el => el.type === 'button');
        if (hasInput && hasButton) return 'form-submission';

        const hasLinks = group.filter(el => el.type === 'link').length > 3;
        if (hasLinks) return 'navigation';

        return 'general';
    }

    private generateActions(group: TestableElement[]): TestAction[] {
        return group.map((el, i) => {
            const actionType = this.getActionType(el);
            return {
                id: `act-${i}`,
                targetElement: el,
                actionType,
                testInput: actionType === 'fill' ? this.getSampleInput(el) : undefined,
                expectedResult: this.getExpectedResult(el, actionType)
            };
        });
    }

    private getActionType(el: TestableElement): ActionType {
        if (el.type === 'button' || el.type === 'link') return 'click';
        if (el.type === 'text-input' || el.type === 'textarea') return 'fill';
        if (el.type === 'checkbox') return 'check';
        if (el.type === 'radio') return 'click'; // or check
        if (el.type === 'select') return 'select';
        if (el.type === 'file-input') return 'upload';
        return 'click';
    }

    private getSampleInput(el: TestableElement): string {
        const label = el.label.toLowerCase();
        if (label.includes('email')) return 'test@example.com';
        if (label.includes('password')) return 'password123';
        if (label.includes('phone') || label.includes('tel')) return '010-1234-5678';
        if (label.includes('name')) return 'Test User';
        return 'Sample Text';
    }

    private getExpectedResult(el: TestableElement, action: ActionType): string {
        if (action === 'fill') return `${el.label || 'Input'} field is filled.`;
        if (action === 'click') {
            if (el.type === 'link') return `Navigate to ${el.attributes['href'] || 'the destination'}.`;
            return `${el.label || 'Button'} is clicked.`;
        }
        return `${el.label || 'Element'} is interacted with.`;
    }

    private generateScenarioName(category: ScenarioCategory, group: TestableElement[], index: number): string {
        const labels = group.filter(el => el.label).map(el => el.label).slice(0, 2).join(', ');
        return `${category.replace('-', ' ')}: ${labels || 'Section ' + index}`;
    }

    private guessPriority(category: ScenarioCategory, group: TestableElement[]): 1 | 2 | 3 {
        if (category === 'authentication' || category === 'form-submission') return 1;
        if (category === 'navigation' || category === 'search') return 2;
        return 3;
    }
}
