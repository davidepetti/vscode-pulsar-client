import { Logger } from './Logger';

type EventCallback = (...args: any[]) => void | Promise<void>;

/**
 * Simple event bus for decoupling components
 */
export class EventBus {
    private logger = Logger.getLogger('EventBus');
    private listeners: Map<string, EventCallback[]> = new Map();

    /**
     * Subscribe to an event
     */
    on(event: string, callback: EventCallback): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        this.listeners.get(event)!.push(callback);
        this.logger.debug(`Listener added for event: ${event}`);

        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event (one-time)
     */
    once(event: string, callback: EventCallback): () => void {
        const wrapper = (...args: any[]) => {
            this.off(event, wrapper);
            callback(...args);
        };

        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     */
    off(event: string, callback: EventCallback): void {
        const callbacks = this.listeners.get(event);

        if (!callbacks) {
            return;
        }

        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
            this.logger.debug(`Listener removed for event: ${event}`);
        }

        if (callbacks.length === 0) {
            this.listeners.delete(event);
        }
    }

    /**
     * Emit an event to all subscribers
     */
    async emit(event: string, ...args: any[]): Promise<void> {
        const callbacks = this.listeners.get(event);

        if (!callbacks || callbacks.length === 0) {
            this.logger.debug(`No listeners for event: ${event}`);
            return;
        }

        this.logger.debug(`Emitting event: ${event} to ${callbacks.length} listener(s)`);

        const promises = callbacks.map(callback => {
            try {
                const result = callback(...args);
                return result instanceof Promise ? result : Promise.resolve();
            } catch (error) {
                this.logger.error(`Error in event listener for ${event}`, error);
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
    }

    /**
     * Emit an event synchronously (fire and forget)
     */
    emitSync(event: string, ...args: any[]): void {
        const callbacks = this.listeners.get(event);

        if (!callbacks || callbacks.length === 0) {
            return;
        }

        this.logger.debug(`Emitting sync event: ${event} to ${callbacks.length} listener(s)`);

        callbacks.forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                this.logger.error(`Error in event listener for ${event}`, error);
            }
        });
    }

    /**
     * Get all registered events
     */
    getEvents(): string[] {
        return Array.from(this.listeners.keys());
    }

    /**
     * Get listener count for an event
     */
    listenerCount(event: string): number {
        return this.listeners.get(event)?.length || 0;
    }

    /**
     * Clear all listeners for an event
     */
    removeAllListeners(event?: string): void {
        if (event) {
            this.listeners.delete(event);
            this.logger.debug(`All listeners removed for event: ${event}`);
        } else {
            this.listeners.clear();
            this.logger.debug('All listeners removed');
        }
    }
}

/**
 * Common event names used throughout the extension
 */
export const PulsarEvents = {
    // Cluster events
    CLUSTER_ADDED: 'cluster:added',
    CLUSTER_REMOVED: 'cluster:removed',
    CLUSTER_UPDATED: 'cluster:updated',
    CLUSTER_CONNECTED: 'cluster:connected',
    CLUSTER_DISCONNECTED: 'cluster:disconnected',

    // Tenant events
    TENANT_CREATED: 'tenant:created',
    TENANT_DELETED: 'tenant:deleted',

    // Namespace events
    NAMESPACE_CREATED: 'namespace:created',
    NAMESPACE_DELETED: 'namespace:deleted',

    // Topic events
    TOPIC_CREATED: 'topic:created',
    TOPIC_DELETED: 'topic:deleted',
    TOPIC_UPDATED: 'topic:updated',

    // Subscription events
    SUBSCRIPTION_CREATED: 'subscription:created',
    SUBSCRIPTION_DELETED: 'subscription:deleted',
    SUBSCRIPTION_RESET: 'subscription:reset',

    // UI events
    REFRESH_REQUESTED: 'ui:refreshRequested',
    REFRESH_COMPLETED: 'ui:refreshCompleted',
} as const;
