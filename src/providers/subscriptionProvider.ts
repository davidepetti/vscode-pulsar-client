import * as vscode from 'vscode';
import { BaseProvider } from './BaseProvider';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import {
    PulsarTreeItem,
    ClusterNode,
    SubscriptionNode,
    LimitedAccessInfoNode,
    AddNamespaceActionNode
} from '../types/nodes';

/**
 * Tree data provider for subscriptions view
 * Shows all subscriptions across all topics in all clusters
 */
export class SubscriptionProvider extends BaseProvider<PulsarTreeItem> {

    constructor(clientManager: PulsarClientManager) {
        super(clientManager, 'SubscriptionProvider');
    }

    async getChildren(element?: PulsarTreeItem): Promise<PulsarTreeItem[]> {
        if (!element) {
            // Root level - show clusters
            return this.getClusterNodes();
        }

        if (element.contextValue === 'cluster') {
            return this.getSubscriptionsForCluster(element.clusterName);
        }

        return [];
    }

    /**
     * Get cluster nodes
     */
    private getClusterNodes(): PulsarTreeItem[] {
        const clusterNames = this.clientManager.getClusters();

        if (clusterNames.length === 0) {
            return [this.createEmptyItem('No clusters configured') as PulsarTreeItem];
        }

        return clusterNames.map(name => {
            const connection = this.clientManager.getClusterConnection(name);
            return new ClusterNode(name, connection?.webServiceUrl || '');
        });
    }

    /**
     * Get all subscriptions for a cluster
     */
    private async getSubscriptionsForCluster(clusterName: string): Promise<PulsarTreeItem[]> {
        const subscriptions: SubscriptionNode[] = [];
        let hasPermissionError = false;

        // Try to get tenants from API
        let tenantsFromApi: string[] = [];
        try {
            tenantsFromApi = await this.clientManager.getTenants(clusterName);
        } catch (error: any) {
            if (ErrorHandler.isAuthenticationError(error) || ErrorHandler.isAuthorizationError(error)) {
                hasPermissionError = true;
                this.logger.warn(`Limited permissions for cluster "${clusterName}" - cannot list tenants`);
            } else {
                ErrorHandler.handleSilently(error, 'Loading subscriptions');
            }
        }

        // Get manually configured namespaces
        const manualNamespaces = this.clientManager.getManualNamespaces(clusterName);

        // Build list of tenant/namespace pairs to check
        const namespacesToCheck: { tenant: string; namespace: string }[] = [];

        // Add namespaces from API tenants
        for (const tenant of tenantsFromApi) {
            try {
                const namespaces = await this.clientManager.getNamespaces(clusterName, tenant);
                for (const namespace of namespaces) {
                    namespacesToCheck.push({ tenant, namespace });
                }
            } catch {
                // Skip tenants we can't access
            }
        }

        // Add manual namespaces
        for (const ns of manualNamespaces) {
            const parts = ns.split('/');
            if (parts.length === 2) {
                namespacesToCheck.push({ tenant: parts[0], namespace: parts[1] });
            }
        }

        // Get subscriptions from all accessible namespaces
        for (const { tenant, namespace } of namespacesToCheck) {
            try {
                const topics = await this.clientManager.getTopics(clusterName, tenant, namespace);

                for (const topic of topics) {
                    // Skip partition topics
                    if (topic.match(/-partition-\d+$/)) {
                        continue;
                    }

                    const topicName = this.extractTopicName(topic);

                    try {
                        const fullTopic = `persistent://${tenant}/${namespace}/${topicName}`;
                        const subs = await this.clientManager.getSubscriptions(clusterName, fullTopic);
                        const stats = await this.clientManager.getTopicStats(clusterName, fullTopic).catch(() => null);

                        for (const sub of subs) {
                            const subStats = stats?.subscriptions[sub];
                            subscriptions.push(new SubscriptionNode(
                                sub,
                                clusterName,
                                tenant,
                                namespace,
                                topicName,
                                subStats?.type,
                                subStats?.msgBacklog
                            ));
                        }
                    } catch {
                        // Skip topics with errors
                    }
                }
            } catch {
                // Skip namespaces we can't access
            }
        }

        // Build result
        const result: PulsarTreeItem[] = [];

        if (hasPermissionError && subscriptions.length === 0 && manualNamespaces.length === 0) {
            result.push(new LimitedAccessInfoNode(clusterName, 'Limited permissions'));
            result.push(new AddNamespaceActionNode(clusterName));
            return result;
        }

        if (subscriptions.length === 0) {
            return [this.createEmptyItem('No subscriptions found') as PulsarTreeItem];
        }

        // Sort by subscription name
        return subscriptions.sort((a, b) =>
            (a.subscriptionName || '').localeCompare(b.subscriptionName || '')
        );
    }

    /**
     * Extract topic name from full topic path
     */
    private extractTopicName(fullTopic: string): string {
        const match = fullTopic.match(/^(?:persistent|non-persistent):\/\/[^/]+\/[^/]+\/(.+)$/);
        if (match) {
            return match[1];
        }
        return fullTopic.split('/').pop() || fullTopic;
    }
}
