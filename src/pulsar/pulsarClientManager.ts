import * as vscode from 'vscode';
import { Logger } from '../infrastructure/Logger';
import { CredentialManager } from '../infrastructure/CredentialManager';
import { PulsarAdminClient } from './pulsarAdminClient';
import {
    PulsarClusterConnection,
    ClusterInfo,
    TenantInfo,
    NamespacePolicies,
    TopicStats,
    PartitionedTopicMetadata,
    SubscriptionStats,
    BrokerInfo
} from '../types/pulsar';

/**
 * Internal cluster configuration with admin client
 */
interface ClusterConfig {
    connection: PulsarClusterConnection;
    adminClient: PulsarAdminClient;
}

/**
 * Central manager for all Pulsar connections and operations
 */
export class PulsarClientManager {
    private logger = Logger.getLogger('PulsarClientManager');
    private clusters: Map<string, ClusterConfig> = new Map();

    constructor(private credentialManager?: CredentialManager) {}

    // ==================== Cluster Management ====================

    /**
     * Add a new cluster connection
     */
    async addCluster(connection: PulsarClusterConnection): Promise<void> {
        this.logger.info(`Adding cluster: ${connection.name}`);

        // Get auth token if needed
        let authToken: string | undefined;
        if (connection.authMethod === 'token' && this.credentialManager) {
            authToken = await this.credentialManager.getAuthToken(connection.name);
        }

        const adminClient = new PulsarAdminClient(
            connection.webServiceUrl,
            authToken || connection.authToken,
            vscode.workspace.getConfiguration('pulsar').get('requestTimeout', 60000)
        );

        // Test connection - try multiple endpoints as some may require admin permissions
        let connected = await adminClient.healthCheck();

        if (!connected) {
            // Try getting clusters - often works with limited permissions
            try {
                await adminClient.getClusters();
                connected = true;
            } catch {
                // Ignore - will try tenants next
            }
        }

        if (!connected) {
            // Try getting tenants - requires more permissions
            try {
                await adminClient.getTenants();
                connected = true;
            } catch (error: any) {
                // If we get a 401/403, the connection works but permissions are limited
                // Accept the connection anyway - user can still browse what they have access to
                if (error?.status === 401 || error?.status === 403 || error?.statusCode === 401 || error?.statusCode === 403) {
                    this.logger.warn(`Limited permissions for cluster "${connection.name}" - some operations may fail`);
                    connected = true;
                } else {
                    const message = error?.message || 'Unknown error';
                    throw new Error(`Failed to connect to cluster "${connection.name}": ${message}`);
                }
            }
        }

        this.clusters.set(connection.name, {
            connection,
            adminClient
        });

        // Save configuration
        await this.saveConfiguration();

        this.logger.info(`Cluster added successfully: ${connection.name}`);
    }

    /**
     * Remove a cluster connection
     */
    async removeCluster(clusterName: string): Promise<void> {
        this.logger.info(`Removing cluster: ${clusterName}`);

        this.clusters.delete(clusterName);

        // Delete stored credentials
        if (this.credentialManager) {
            await this.credentialManager.deleteCredentials(clusterName);
        }

        await this.saveConfiguration();

        this.logger.info(`Cluster removed: ${clusterName}`);
    }

    /**
     * Get list of configured cluster names
     */
    getClusters(): string[] {
        return Array.from(this.clusters.keys());
    }

    /**
     * Get cluster connection configuration
     */
    getClusterConnection(clusterName: string): PulsarClusterConnection | undefined {
        return this.clusters.get(clusterName)?.connection;
    }

    /**
     * Check if cluster exists
     */
    hasCluster(clusterName: string): boolean {
        return this.clusters.has(clusterName);
    }

    // ==================== Tenant Operations ====================

    /**
     * Get tenants for a cluster
     */
    async getTenants(clusterName: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.getTenants();
    }

    /**
     * Get tenant info
     */
    async getTenantInfo(clusterName: string, tenant: string): Promise<TenantInfo> {
        const admin = this.getAdminClient(clusterName);
        return admin.getTenantInfo(tenant);
    }

    /**
     * Create a tenant
     */
    async createTenant(clusterName: string, tenant: string, config?: TenantInfo): Promise<void> {
        const admin = this.getAdminClient(clusterName);

        // Get cluster info to set allowed clusters
        const clusters = await admin.getClusters();
        const tenantConfig: TenantInfo = {
            allowedClusters: clusters,
            ...config
        };

        await admin.createTenant(tenant, tenantConfig);
    }

    /**
     * Delete a tenant
     */
    async deleteTenant(clusterName: string, tenant: string): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.deleteTenant(tenant);
    }

    // ==================== Namespace Operations ====================

    /**
     * Get namespaces for a tenant
     */
    async getNamespaces(clusterName: string, tenant: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        const namespaces = await admin.getNamespaces(tenant);
        // Extract namespace name from full path (tenant/namespace)
        return namespaces.map(ns => ns.split('/').pop() || ns);
    }

    /**
     * Get namespace policies
     */
    async getNamespacePolicies(clusterName: string, tenant: string, namespace: string): Promise<NamespacePolicies> {
        const admin = this.getAdminClient(clusterName);
        return admin.getNamespacePolicies(tenant, namespace);
    }

    /**
     * Create a namespace
     */
    async createNamespace(clusterName: string, tenant: string, namespace: string): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.createNamespace(tenant, namespace);
    }

    /**
     * Delete a namespace
     */
    async deleteNamespace(clusterName: string, tenant: string, namespace: string, force: boolean = false): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.deleteNamespace(tenant, namespace, force);
    }

    // ==================== Topic Operations ====================

    /**
     * Get topics for a namespace
     */
    async getTopics(clusterName: string, tenant: string, namespace: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.getTopics(tenant, namespace);
    }

    /**
     * Get partitioned topics for a namespace
     */
    async getPartitionedTopics(clusterName: string, tenant: string, namespace: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.getPartitionedTopics(tenant, namespace);
    }

    /**
     * Get topic metadata
     */
    async getTopicMetadata(clusterName: string, topic: string): Promise<PartitionedTopicMetadata> {
        const admin = this.getAdminClient(clusterName);
        return admin.getTopicMetadata(topic);
    }

    /**
     * Get topic statistics
     */
    async getTopicStats(clusterName: string, topic: string): Promise<TopicStats> {
        const admin = this.getAdminClient(clusterName);
        return admin.getTopicStats(topic);
    }

    /**
     * Create a topic
     */
    async createTopic(clusterName: string, tenant: string, namespace: string, topicName: string, partitions?: number): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        const fullTopic = `persistent://${tenant}/${namespace}/${topicName}`;

        if (partitions && partitions > 0) {
            await admin.createPartitionedTopic(fullTopic, partitions);
        } else {
            await admin.createTopic(fullTopic);
        }
    }

    /**
     * Delete a topic
     */
    async deleteTopic(clusterName: string, topic: string, force: boolean = false): Promise<void> {
        const admin = this.getAdminClient(clusterName);

        // Check if it's a partitioned topic
        try {
            const metadata = await admin.getTopicMetadata(topic);
            if (metadata.partitions > 0) {
                await admin.deletePartitionedTopic(topic, force);
            } else {
                await admin.deleteTopic(topic, force);
            }
        } catch {
            // If we can't get metadata, try deleting as non-partitioned
            await admin.deleteTopic(topic, force);
        }
    }

    // ==================== Subscription Operations ====================

    /**
     * Get subscriptions for a topic
     */
    async getSubscriptions(clusterName: string, topic: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.getSubscriptions(topic);
    }

    /**
     * Get subscription stats
     */
    async getSubscriptionStats(clusterName: string, topic: string, subscription: string): Promise<SubscriptionStats> {
        const admin = this.getAdminClient(clusterName);
        return admin.getSubscriptionStats(topic, subscription);
    }

    /**
     * Create a subscription
     */
    async createSubscription(
        clusterName: string,
        topic: string,
        subscription: string,
        position: 'earliest' | 'latest' = 'latest'
    ): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.createSubscription(topic, subscription, position);
    }

    /**
     * Delete a subscription
     */
    async deleteSubscription(clusterName: string, topic: string, subscription: string, force: boolean = false): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.deleteSubscription(topic, subscription, force);
    }

    /**
     * Reset subscription to a timestamp
     */
    async resetSubscription(clusterName: string, topic: string, subscription: string, timestamp: number): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.resetSubscription(topic, subscription, timestamp);
    }

    /**
     * Skip all messages in subscription
     */
    async skipAllMessages(clusterName: string, topic: string, subscription: string): Promise<void> {
        const admin = this.getAdminClient(clusterName);
        await admin.skipAllMessages(topic, subscription);
    }

    /**
     * Peek messages from a subscription (view without consuming)
     */
    async peekMessages(clusterName: string, topic: string, subscription: string, count: number = 1): Promise<any[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.peekMessages(topic, subscription, count);
    }

    // ==================== Broker Operations ====================

    /**
     * Get list of brokers
     */
    async getBrokers(clusterName: string): Promise<string[]> {
        const admin = this.getAdminClient(clusterName);
        return admin.getBrokers();
    }

    /**
     * Get broker stats
     */
    async getBrokerStats(clusterName: string): Promise<BrokerInfo> {
        const admin = this.getAdminClient(clusterName);
        return admin.getBrokerStats();
    }

    // ==================== Cluster Info ====================

    /**
     * Get cluster information
     */
    async getClusterInfo(clusterName: string): Promise<ClusterInfo> {
        const admin = this.getAdminClient(clusterName);
        const clusters = await admin.getClusters();
        if (clusters.length > 0) {
            return admin.getClusterInfo(clusters[0]);
        }
        return {};
    }

    // ==================== Manual Namespace Management ====================

    /**
     * Get manually configured namespaces for a cluster
     * These are namespaces added by users who don't have LIST_TENANTS permission
     */
    getManualNamespaces(clusterName: string): string[] {
        const config = vscode.workspace.getConfiguration('pulsar');
        const manualNamespaces = config.get<Record<string, string[]>>('manualNamespaces', {});
        return manualNamespaces[clusterName] || [];
    }

    /**
     * Add a manually configured namespace
     * @param clusterName The cluster name
     * @param namespacePath The namespace path in format "tenant/namespace"
     */
    async addManualNamespace(clusterName: string, namespacePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('pulsar');
        const manualNamespaces = config.get<Record<string, string[]>>('manualNamespaces', {});

        if (!manualNamespaces[clusterName]) {
            manualNamespaces[clusterName] = [];
        }

        if (!manualNamespaces[clusterName].includes(namespacePath)) {
            manualNamespaces[clusterName].push(namespacePath);
            await config.update('manualNamespaces', manualNamespaces, vscode.ConfigurationTarget.Global);
            this.logger.info(`Added manual namespace "${namespacePath}" to cluster "${clusterName}"`);
        }
    }

    /**
     * Remove a manually configured namespace
     */
    async removeManualNamespace(clusterName: string, namespacePath: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('pulsar');
        const manualNamespaces = config.get<Record<string, string[]>>('manualNamespaces', {});

        if (manualNamespaces[clusterName]) {
            manualNamespaces[clusterName] = manualNamespaces[clusterName].filter(ns => ns !== namespacePath);
            if (manualNamespaces[clusterName].length === 0) {
                delete manualNamespaces[clusterName];
            }
            await config.update('manualNamespaces', manualNamespaces, vscode.ConfigurationTarget.Global);
            this.logger.info(`Removed manual namespace "${namespacePath}" from cluster "${clusterName}"`);
        }
    }

    // ==================== Configuration ====================

    /**
     * Load saved configuration from VSCode settings
     */
    async loadConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('pulsar');
        const savedClusters = config.get<any[]>('clusters', []);

        for (const saved of savedClusters) {
            try {
                const connection: PulsarClusterConnection = {
                    name: saved.name,
                    type: saved.type || 'pulsar',
                    webServiceUrl: saved.webServiceUrl,
                    serviceUrl: saved.serviceUrl,
                    authMethod: saved.authMethod || 'none',
                    tlsAllowInsecure: saved.tlsAllowInsecure
                };

                // Get auth token from secure storage if needed
                if (connection.authMethod === 'token' && this.credentialManager) {
                    const token = await this.credentialManager.getAuthToken(connection.name);
                    if (token) {
                        connection.authToken = token;
                    }
                }

                const adminClient = new PulsarAdminClient(
                    connection.webServiceUrl,
                    connection.authToken,
                    config.get('requestTimeout', 60000)
                );

                this.clusters.set(connection.name, {
                    connection,
                    adminClient
                });

                this.logger.info(`Loaded cluster configuration: ${connection.name}`);
            } catch (error) {
                this.logger.error(`Failed to load cluster: ${saved.name}`, error);
            }
        }
    }

    /**
     * Save configuration to VSCode settings
     */
    private async saveConfiguration(): Promise<void> {
        const config = vscode.workspace.getConfiguration('pulsar');

        const clustersToSave = Array.from(this.clusters.values()).map(({ connection }) => ({
            name: connection.name,
            type: connection.type,
            webServiceUrl: connection.webServiceUrl,
            serviceUrl: connection.serviceUrl,
            authMethod: connection.authMethod,
            tlsAllowInsecure: connection.tlsAllowInsecure
            // Note: Never save sensitive data like tokens
        }));

        await config.update('clusters', clustersToSave, vscode.ConfigurationTarget.Global);
    }

    // ==================== Helper Methods ====================

    /**
     * Get auth token for a cluster (for token decoding purposes)
     */
    async getAuthToken(clusterName: string): Promise<string | undefined> {
        const cluster = this.clusters.get(clusterName);
        if (!cluster) {
            return undefined;
        }

        // First check if token is in the connection object
        if (cluster.connection.authToken) {
            return cluster.connection.authToken;
        }

        // Otherwise try to get from credential manager
        if (cluster.connection.authMethod === 'token' && this.credentialManager) {
            return this.credentialManager.getAuthToken(clusterName);
        }

        return undefined;
    }

    /**
     * Get admin client for a cluster
     */
    private getAdminClient(clusterName: string): PulsarAdminClient {
        const cluster = this.clusters.get(clusterName);
        if (!cluster) {
            throw new Error(`Cluster not found: ${clusterName}`);
        }
        return cluster.adminClient;
    }

    /**
     * Dispose all connections
     */
    async dispose(): Promise<void> {
        this.logger.info('Disposing PulsarClientManager');
        this.clusters.clear();
    }
}
