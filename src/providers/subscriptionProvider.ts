import * as vscode from 'vscode';
import { BaseProvider } from './BaseProvider';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import {
    PulsarTreeItem,
    ClusterNode,
    SubscriptionNode
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
        return this.getChildrenSafely(
            undefined,
            async () => {
                const subscriptions: SubscriptionNode[] = [];

                // Get all tenants
                const tenants = await this.clientManager.getTenants(clusterName);

                for (const tenant of tenants) {
                    // Get all namespaces for tenant
                    const namespaces = await this.clientManager.getNamespaces(clusterName, tenant);

                    for (const namespace of namespaces) {
                        // Get all topics for namespace
                        const topics = await this.clientManager.getTopics(clusterName, tenant, namespace);

                        for (const topic of topics) {
                            // Skip partition topics
                            if (topic.match(/-partition-\d+$/)) {
                                continue;
                            }

                            const topicName = this.extractTopicName(topic);

                            try {
                                // Get subscriptions for topic
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
                    }
                }

                if (subscriptions.length === 0) {
                    return [this.createEmptyItem('No subscriptions found') as PulsarTreeItem];
                }

                // Sort by subscription name
                return subscriptions.sort((a, b) =>
                    (a.subscriptionName || '').localeCompare(b.subscriptionName || '')
                );
            },
            'Loading subscriptions'
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
