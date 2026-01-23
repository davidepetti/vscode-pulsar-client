import { Logger } from '../infrastructure/Logger';
import {
    ClusterInfo,
    TenantInfo,
    NamespacePolicies,
    TopicStats,
    TopicMetadata,
    PartitionedTopicMetadata,
    TopicInternalStats,
    BrokerInfo,
    SubscriptionStats,
    SchemaInfo
} from '../types/pulsar';

/**
 * HTTP client for Pulsar Admin REST API
 */
export class PulsarAdminClient {
    private logger = Logger.getLogger('PulsarAdminClient');
    private baseUrl: string;
    private authToken?: string;
    private requestTimeout: number;

    constructor(
        webServiceUrl: string,
        authToken?: string,
        requestTimeout: number = 30000
    ) {
        // Ensure URL doesn't have trailing slash
        this.baseUrl = webServiceUrl.replace(/\/$/, '');
        this.authToken = authToken;
        this.requestTimeout = requestTimeout;
    }

    /**
     * Update authentication token
     */
    setAuthToken(token: string | undefined): void {
        this.authToken = token;
    }

    // ==================== Cluster Operations ====================

    /**
     * Get list of clusters
     */
    async getClusters(): Promise<string[]> {
        return this.get<string[]>('/admin/v2/clusters');
    }

    /**
     * Get cluster information
     */
    async getClusterInfo(cluster: string): Promise<ClusterInfo> {
        return this.get<ClusterInfo>(`/admin/v2/clusters/${encodeURIComponent(cluster)}`);
    }

    // ==================== Tenant Operations ====================

    /**
     * Get list of tenants
     */
    async getTenants(): Promise<string[]> {
        return this.get<string[]>('/admin/v2/tenants');
    }

    /**
     * Get tenant information
     */
    async getTenantInfo(tenant: string): Promise<TenantInfo> {
        return this.get<TenantInfo>(`/admin/v2/tenants/${encodeURIComponent(tenant)}`);
    }

    /**
     * Create a new tenant
     */
    async createTenant(tenant: string, config: TenantInfo): Promise<void> {
        await this.put(`/admin/v2/tenants/${encodeURIComponent(tenant)}`, config);
    }

    /**
     * Delete a tenant
     */
    async deleteTenant(tenant: string): Promise<void> {
        await this.delete(`/admin/v2/tenants/${encodeURIComponent(tenant)}`);
    }

    // ==================== Namespace Operations ====================

    /**
     * Get list of namespaces for a tenant
     */
    async getNamespaces(tenant: string): Promise<string[]> {
        return this.get<string[]>(`/admin/v2/namespaces/${encodeURIComponent(tenant)}`);
    }

    /**
     * Get namespace policies
     */
    async getNamespacePolicies(tenant: string, namespace: string): Promise<NamespacePolicies> {
        return this.get<NamespacePolicies>(
            `/admin/v2/namespaces/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}`
        );
    }

    /**
     * Create a new namespace
     */
    async createNamespace(tenant: string, namespace: string, policies?: NamespacePolicies): Promise<void> {
        await this.put(
            `/admin/v2/namespaces/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}`,
            policies || {}
        );
    }

    /**
     * Delete a namespace
     */
    async deleteNamespace(tenant: string, namespace: string, force: boolean = false): Promise<void> {
        const query = force ? '?force=true' : '';
        await this.delete(
            `/admin/v2/namespaces/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}${query}`
        );
    }

    // ==================== Topic Operations ====================

    /**
     * Get list of topics in a namespace
     */
    async getTopics(tenant: string, namespace: string): Promise<string[]> {
        const persistent = await this.get<string[]>(
            `/admin/v2/persistent/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}`
        ).catch(() => []);

        const nonPersistent = await this.get<string[]>(
            `/admin/v2/non-persistent/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}`
        ).catch(() => []);

        return [...persistent, ...nonPersistent];
    }

    /**
     * Get partitioned topics in a namespace
     */
    async getPartitionedTopics(tenant: string, namespace: string): Promise<string[]> {
        return this.get<string[]>(
            `/admin/v2/persistent/${encodeURIComponent(tenant)}/${encodeURIComponent(namespace)}/partitioned`
        );
    }

    /**
     * Get topic metadata (partitions)
     */
    async getTopicMetadata(topic: string): Promise<PartitionedTopicMetadata> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<PartitionedTopicMetadata>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/partitions`
        );
    }

    /**
     * Get topic statistics
     */
    async getTopicStats(topic: string): Promise<TopicStats> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<TopicStats>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/stats`
        );
    }

    /**
     * Get partitioned topic statistics (aggregated across all partitions)
     */
    async getPartitionedTopicStats(topic: string): Promise<TopicStats> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<TopicStats>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/partitioned-stats`
        );
    }

    /**
     * Get topic internal stats
     */
    async getTopicInternalStats(topic: string): Promise<TopicInternalStats> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<TopicInternalStats>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/internalStats`
        );
    }

    /**
     * Create a non-partitioned topic
     */
    async createTopic(topic: string): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.put(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}`,
            undefined
        );
    }

    /**
     * Create a partitioned topic
     */
    async createPartitionedTopic(topic: string, partitions: number): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.put(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/partitions`,
            partitions
        );
    }

    /**
     * Delete a topic
     */
    async deleteTopic(topic: string, force: boolean = false): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        const query = force ? '?force=true' : '';
        await this.delete(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}${query}`
        );
    }

    /**
     * Delete a partitioned topic
     */
    async deletePartitionedTopic(topic: string, force: boolean = false): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        const query = force ? '?force=true' : '';
        await this.delete(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/partitions${query}`
        );
    }

    // ==================== Subscription Operations ====================

    /**
     * Get subscriptions for a topic
     */
    async getSubscriptions(topic: string): Promise<string[]> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<string[]>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscriptions`
        );
    }

    /**
     * Get subscription stats
     * Tries regular topic stats first, falls back to partitioned-stats for partitioned topics
     */
    async getSubscriptionStats(topic: string, subscription: string): Promise<SubscriptionStats> {
        let stats: TopicStats;
        try {
            stats = await this.getTopicStats(topic);
        } catch (error: any) {
            if (error?.status === 404 || error?.statusCode === 404) {
                stats = await this.getPartitionedTopicStats(topic);
            } else {
                throw error;
            }
        }
        return stats.subscriptions[subscription];
    }

    /**
     * Create a subscription
     */
    async createSubscription(
        topic: string,
        subscription: string,
        position: 'earliest' | 'latest' = 'latest'
    ): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.put(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}`,
            { messageId: position === 'earliest' ? 'earliest' : 'latest' }
        );
    }

    /**
     * Delete a subscription
     */
    async deleteSubscription(topic: string, subscription: string, force: boolean = false): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        const query = force ? '?force=true' : '';
        await this.delete(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}${query}`
        );
    }

    /**
     * Reset subscription to a position
     */
    async resetSubscription(
        topic: string,
        subscription: string,
        timestamp: number
    ): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.post(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}/resetcursor/${timestamp}`,
            undefined
        );
    }

    /**
     * Skip messages in a subscription
     */
    async skipMessages(topic: string, subscription: string, count: number): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.post(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}/skip/${count}`,
            undefined
        );
    }

    /**
     * Skip all messages in a subscription
     */
    async skipAllMessages(topic: string, subscription: string): Promise<void> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        await this.post(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}/skip_all`,
            undefined
        );
    }

    /**
     * Peek messages from a subscription (view without consuming)
     */
    async peekMessages(topic: string, subscription: string, count: number = 1): Promise<any[]> {
        const { tenant, namespace, topicName, persistent } = this.parseTopic(topic);
        const domain = persistent ? 'persistent' : 'non-persistent';
        return this.get<any[]>(
            `/admin/v2/${domain}/${tenant}/${namespace}/${topicName}/subscription/${encodeURIComponent(subscription)}/position/${count}`
        );
    }

    // ==================== Broker Operations ====================

    /**
     * Get list of active brokers
     */
    async getBrokers(cluster?: string): Promise<string[]> {
        if (cluster) {
            return this.get<string[]>(`/admin/v2/brokers/${encodeURIComponent(cluster)}`);
        }
        // Get brokers from all clusters
        const clusters = await this.getClusters();
        const brokers: string[] = [];
        for (const c of clusters) {
            try {
                const clusterBrokers = await this.get<string[]>(`/admin/v2/brokers/${encodeURIComponent(c)}`);
                brokers.push(...clusterBrokers);
            } catch {
                // Ignore errors for individual clusters
            }
        }
        return brokers;
    }

    /**
     * Get broker stats
     */
    async getBrokerStats(): Promise<BrokerInfo> {
        return this.get<BrokerInfo>('/admin/v2/broker-stats/broker');
    }

    /**
     * Get load report from broker
     */
    async getBrokerLoadReport(): Promise<any> {
        return this.get<any>('/admin/v2/broker-stats/load-report');
    }

    // ==================== Schema Operations ====================

    /**
     * Get schema for a topic
     */
    async getSchema(topic: string): Promise<SchemaInfo | null> {
        try {
            const { tenant, namespace, topicName } = this.parseTopic(topic);
            return await this.get<SchemaInfo>(
                `/admin/v2/schemas/${tenant}/${namespace}/${topicName}/schema`
            );
        } catch {
            return null;
        }
    }

    // ==================== Health Check ====================

    /**
     * Check if broker is healthy
     */
    async healthCheck(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/admin/v2/brokers/health`;
            const headers: Record<string, string> = {};
            if (this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }
            const response = await fetch(url, { headers });
            return response.ok;
        } catch {
            return false;
        }
    }

    // ==================== Helper Methods ====================

    /**
     * Parse a topic name into its components
     */
    private parseTopic(topic: string): {
        tenant: string;
        namespace: string;
        topicName: string;
        persistent: boolean;
    } {
        // Format: persistent://tenant/namespace/topic or non-persistent://tenant/namespace/topic
        const match = topic.match(/^(persistent|non-persistent):\/\/([^/]+)\/([^/]+)\/(.+)$/);
        if (match) {
            return {
                persistent: match[1] === 'persistent',
                tenant: match[2],
                namespace: match[3],
                topicName: match[4]
            };
        }

        // Format: tenant/namespace/topic (assume persistent)
        const parts = topic.split('/');
        if (parts.length === 3) {
            return {
                persistent: true,
                tenant: parts[0],
                namespace: parts[1],
                topicName: parts[2]
            };
        }

        // Just topic name - shouldn't happen but handle gracefully
        return {
            persistent: true,
            tenant: 'public',
            namespace: 'default',
            topicName: topic
        };
    }

    /**
     * Make a GET request
     */
    private async get<T>(path: string): Promise<T> {
        return this.request<T>('GET', path);
    }

    /**
     * Make a POST request
     */
    private async post<T>(path: string, body: any): Promise<T> {
        return this.request<T>('POST', path, body);
    }

    /**
     * Make a PUT request
     */
    private async put<T>(path: string, body: any): Promise<T> {
        return this.request<T>('PUT', path, body);
    }

    /**
     * Make a DELETE request
     */
    private async delete<T>(path: string): Promise<T> {
        return this.request<T>('DELETE', path);
    }

    /**
     * Make an HTTP request to the Pulsar Admin API
     */
    private async request<T>(method: string, path: string, body?: any): Promise<T> {
        const url = `${this.baseUrl}${path}`;

        const headers: Record<string, string> = {
            'Accept': 'application/json'
        };

        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }

        if (this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

        try {
            this.logger.debug(`${method} ${url}`);

            const response = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                const error = new Error(`HTTP ${response.status}: ${errorText}`);
                (error as any).status = response.status;
                (error as any).statusCode = response.status;
                throw error;
            }

            // Handle empty responses
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                return undefined as T;
            }

            const text = await response.text();
            if (!text) {
                return undefined as T;
            }

            return JSON.parse(text) as T;
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${this.requestTimeout}ms`);
            }

            this.logger.error(`Request failed: ${method} ${url}`, error);
            throw error;
        }
    }
}
