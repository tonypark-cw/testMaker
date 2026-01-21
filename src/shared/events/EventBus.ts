type EventHandler<T = any> = (data: T) => void | Promise<void>;

/**
 * EventBus enables decoupled communication between components.
 */
export class EventBus {
    private static instance: EventBus;
    private handlers: Map<string, EventHandler[]> = new Map();

    private constructor() { }

    public static getInstance(): EventBus {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    /**
     * Subscribe to an event.
     */
    public subscribe<T = any>(event: string, handler: EventHandler<T>): void {
        const eventHandlers = this.handlers.get(event) || [];
        eventHandlers.push(handler);
        this.handlers.set(event, eventHandlers);
    }

    /**
     * Publish an event.
     */
    public async publish<T = any>(event: string, data: T): Promise<void> {
        const eventHandlers = this.handlers.get(event);
        if (!eventHandlers) return;

        // Execute all handlers. We use Promise.all to support both sync and async handlers.
        await Promise.all(eventHandlers.map(handler => {
            try {
                return handler(data);
            } catch (e) {
                console.error(`[EventBus] Error in handler for event ${event}:`, e);
            }
        }));
    }

    /**
     * Unsubscribe from an event.
     */
    public unsubscribe(event: string, handler: EventHandler): void {
        const eventHandlers = this.handlers.get(event);
        if (!eventHandlers) return;

        const index = eventHandlers.indexOf(handler);
        if (index !== -1) {
            eventHandlers.splice(index, 1);
        }
    }

    /**
     * For testing purposes: clear all handlers.
     */
    public _reset(): void {
        this.handlers.clear();
    }
}
