/** 테스트 가능한 요소 정보 */
export interface TestableElement {
    /** 고유 식별자 */
    id: string;
    /** CSS 선택자 */
    selector: string;
    /** data-testid 값 (있는 경우) */
    testId?: string;
    /** 요소 태그명 */
    tag: string;
    /** 요소 타입 */
    type: ElementType;
    /** 요소 텍스트 또는 라벨 */
    label: string;
    /** 화면 상 위치 */
    rect: {
        top: number;
        left: number;
        width: number;
        height: number;
    };
    /** 속한 섹션 인덱스 */
    sectionIndex: number;
    /** 요소 상태 */
    state: {
        visible: boolean;
        enabled: boolean;
        required: boolean;
    };
    /** 추가 속성 (placeholder, value, href 등) */
    attributes: Record<string, string>;
}

export type ElementType =
    | 'button'
    | 'link'
    | 'text-input'
    | 'textarea'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'file-input'
    | 'dialog'
    | 'tab'
    | 'menu'
    | 'accordion'
    | 'custom';

/** 테스트 액션 정의 */
export interface TestAction {
    /** 액션 ID */
    id: string;
    /** 대상 요소 */
    targetElement: TestableElement;
    /** 액션 타입 */
    actionType: ActionType;
    /** 테스트 입력값 (있는 경우) */
    testInput?: string;
    /** 예상 결과 */
    expectedResult: string;
}

export type ActionType =
    | 'click'
    | 'fill'
    | 'select'
    | 'check'
    | 'uncheck'
    | 'upload'
    | 'hover'
    | 'focus'
    | 'navigate';

/** 테스트 시나리오 (그룹화된 액션들) */
export interface TestScenario {
    /** 시나리오 ID */
    id: string;
    /** 시나리오 이름 */
    name: string;
    /** 시나리오 카테고리 */
    category: ScenarioCategory;
    /** 시나리오 설명 */
    description: string;
    /** 포함된 액션들 */
    actions: TestAction[];
    /** 우선순위 (1: 높음, 3: 낮음) */
    priority: 1 | 2 | 3;
}

export type ScenarioCategory =
    | 'form-submission'
    | 'navigation'
    | 'authentication'
    | 'search'
    | 'modal-dialog'
    | 'tab-panel'
    | 'accordion'
    | 'crud-operation'
    | 'general';

/** 모달 발견 정보 */
export interface ModalDiscovery {
    triggerText: string;
    modalTitle: string;
    elements: any[]; // Using any[] for now as scraper returns simplified element structure for modals
    links: string[];
    screenshotPath?: string;
}

/** 분석 결과 */
export interface AnalysisResult {
    success: boolean;
    url: string;
    timestamp: string;
    pageTitle: string;
    elements: TestableElement[];
    scenarios: TestScenario[];
    discoveredLinks: string[];
    sidebarLinks?: string[];
    modalDiscoveries?: ModalDiscovery[];
    actionChain?: any[]; // Recorded interactions
    metadata: {
        totalElements: number;
        byType: Record<string, number>;
        bySection: Record<number, number>;
        domain?: string;
    };
    error?: string;
}

/** 생성 옵션 */
export interface GeneratorOptions {
    outputDir: string;
    formats: string[];
    baseUrl?: string;
    includeScreenshots?: boolean;
}

/** 시나리오 카테고리 추론용 힌트 */
export const SCENARIO_HINTS: Record<ScenarioCategory, string[]> = {
    'form-submission': ['form', 'submit', 'register', 'signup', 'login', 'contact'],
    'navigation': ['nav', 'menu', 'header', 'footer', 'breadcrumb', 'sidebar'],
    'authentication': ['login', 'logout', 'signin', 'signout', 'auth', 'password'],
    'search': ['search', 'filter', 'query', 'find'],
    'modal-dialog': ['modal', 'dialog', 'popup', 'overlay', 'drawer'],
    'tab-panel': ['tab', 'tabs', 'panel', 'tablist'],
    'accordion': ['accordion', 'collapse', 'expand', 'faq', 'details'],
    'crud-operation': ['create', 'edit', 'delete', 'update', 'add', 'remove'],
    'general': [],
};

/**
 * Golden Path analysis result
 * Evaluates page stability and testability
 */
export interface GoldenPathInfo {
    isStable: boolean;            // Overall stability assessment
    hasTestableElements: boolean; // Minimum testable elements present
    confidence: number;           // 0.0 to 1.0 confidence score
    reasons: string[];            // Human-readable analysis reasons
}

