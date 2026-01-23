import * as vscode from 'vscode';
import { BaseProvider } from './BaseProvider';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import {
    PulsarTreeItem,
    ClusterNode,
    TenantNode,
    NamespaceNode,
    TopicNode,
    PartitionNode,
    SubscriptionsContainerNode,
    SubscriptionNode,
    AddNamespaceActionNode,
    LimitedAccessInfoNode
} from '../types/nodes';

/**
 * Tree data provider for the main Pulsar explorer view
 */
export class PulsarExplorerProvider extends BaseProvider<PulsarTreeItem> {

    constructor(clientManager: PulsarClientManager) {
        super(clientManager, 'PulsarExplorerProvider');
    }

    async getChildren(element?: PulsarTreeItem): Promise<PulsarTreeItem[]> {
        if (!element) {
            // Root level - show clusters
            return this.getClustersNodes();
        }

        switch (element.contextValue) {
            case 'cluster':
                return this.getTenantNodes(element.clusterName);

            case 'tenant':
                return this.getNamespaceNodes(element.clusterName, element.tenant!);

            case 'namespace':
                return this.getTopicNodes(element.clusterName, element.tenant!, element.namespace!);

            case 'topic':
                return this.getTopicChildrenNodes(element as TopicNode);

            case 'subscriptionsContainer':
                return this.getSubscriptionNodes(element as SubscriptionsContainerNode);

            default:
                return [];
        }
    }

    getParent(element: PulsarTreeItem): PulsarTreeItem | undefined {
        if (element.contextValue === 'cluster') {
            return undefined;
        }

        if (element.contextValue === 'tenant') {
            const connection = this.clientManager.getClusterConnection(element.clusterName);
            if (connection) {
                return new ClusterNode(element.clusterName, connection.webServiceUrl);
            }
        }

        if (element.contextValue === 'namespace') {
            return new TenantNode(element.tenant!, element.clusterName);
        }

        if (element.contextValue === 'topic') {
            return new NamespaceNode(element.namespace!, element.clusterName, element.tenant!);
        }

        return undefined;
    }

    /**
     * Get cluster nodes
     */
    private getClustersNodes(): PulsarTreeItem[] {
        const clusterNames = this.getClusters();

        if (clusterNames.length === 0) {
            return [this.createEmptyItem('No clusters configured. Click + to add one.') as PulsarTreeItem];
        }

        return clusterNames.map(name => {
            const connection = this.clientManager.getClusterConnection(name);
            return new ClusterNode(name, connection?.webServiceUrl || '');
        });
    }

    /**
     * Get tenant nodes for a cluster
     */
    private async getTenantNodes(clusterName: string): Promise<PulsarTreeItem[]> {
        const nodes: PulsarTreeItem[] = [];
        let tenantsFromApi: string[] = [];
        let hasPermissionError = false;

        // Try to get tenants from API
        try {
            tenantsFromApi = await this.clientManager.getTenants(clusterName);
        } catch (error: any) {
            // Check if this is a permission error
            if (ErrorHandler.isAuthenticationError(error) || ErrorHandler.isAuthorizationError(error)) {
                hasPermissionError = true;
                this.logger.warn(`Limited permissions for cluster "${clusterName}" - cannot list tenants`);
            } else {
                ErrorHandler.handleSilently(error, 'Loading tenants');
            }
        }

        // Get manually configured namespaces
        const manualNamespaces = this.clientManager.getManualNamespaces(clusterName);

        // Extract unique tenants from manual namespaces
        const manualTenants = new Set<string>();
        for (const ns of manualNamespaces) {
            const parts = ns.split('/');
            if (parts.length >= 1) {
                manualTenants.add(parts[0]);
            }
        }

        // Combine API tenants with manual tenants
        const allTenants = new Set([...tenantsFromApi, ...manualTenants]);

        // If we have permission error and no manual namespaces, show info and action
        if (hasPermissionError && manualNamespaces.length === 0) {
            nodes.push(new LimitedAccessInfoNode(clusterName, 'Limited permissions'));
            nodes.push(new AddNamespaceActionNode(clusterName));
            return nodes;
        }

        // Add tenant nodes
        if (allTenants.size > 0) {
            const sortedTenants = Array.from(allTenants).sort((a, b) => a.localeCompare(b));
            for (const tenant of sortedTenants) {
                nodes.push(new TenantNode(tenant, clusterName));
            }
        }

        // If we had permission error but have manual namespaces, still show the add action
        if (hasPermissionError) {
            nodes.push(new AddNamespaceActionNode(clusterName));
        }

        // If no tenants at all
        if (nodes.length === 0) {
            return [this.createEmptyItem('No tenants') as PulsarTreeItem];
        }

        return nodes;
    }

    /**
     * Get namespace nodes for a tenant
     */
    private async getNamespaceNodes(clusterName: string, tenant: string): Promise<PulsarTreeItem[]> {
        let namespacesFromApi: string[] = [];
        let hasPermissionError = false;

        // Try to get namespaces from API
        try {
            namespacesFromApi = await this.clientManager.getNamespaces(clusterName, tenant);
        } catch (error: any) {
            if (ErrorHandler.isAuthenticationError(error) || ErrorHandler.isAuthorizationError(error)) {
                hasPermissionError = true;
                this.logger.warn(`Limited permissions for tenant "${tenant}" - cannot list namespaces`);
            } else {
                ErrorHandler.handleSilently(error, 'Loading namespaces');
            }
        }

        // Get manually configured namespaces for this tenant
        const manualNamespaces = this.clientManager.getManualNamespaces(clusterName);
        const manualNsForTenant = manualNamespaces
            .filter(ns => ns.startsWith(`${tenant}/`))
            .map(ns => ns.split('/')[1]);

        // Combine
        const allNamespaces = new Set([...namespacesFromApi, ...manualNsForTenant]);

        if (allNamespaces.size === 0) {
            if (hasPermissionError) {
                return [this.createEmptyItem('No access to namespaces') as PulsarTreeItem];
            }
            return [this.createEmptyItem('No namespaces') as PulsarTreeItem];
        }

        return Array.from(allNamespaces)
            .sort((a, b) => a.localeCompare(b))
            .map(namespace => new NamespaceNode(namespace, clusterName, tenant));
    }

    /**
     * Get topic nodes for a namespace
     */
    private async getTopicNodes(clusterName: string, tenant: string, namespace: string): Promise<PulsarTreeItem[]> {
        return this.getChildrenSafely(
            undefined,
            async () => {
                const topics = await this.clientManager.getTopics(clusterName, tenant, namespace);
                const partitionedTopics = await this.clientManager.getPartitionedTopics(clusterName, tenant, namespace);

                // Create a set of partitioned topic base names
                const partitionedSet = new Set(partitionedTopics.map(t => this.extractTopicName(t)));

                // Filter out partition topics (topic-partition-N) and get unique topics
                const uniqueTopics = new Set<string>();
                const topicPartitions = new Map<string, number>();

                for (const topic of topics) {
                    const topicName = this.extractTopicName(topic);

                    // Skip individual partition topics
                    const partitionMatch = topicName.match(/^(.+)-partition-\d+$/);
                    if (partitionMatch) {
                        const baseName = partitionMatch[1];
                        const currentCount = topicPartitions.get(baseName) || 0;
                        topicPartitions.set(baseName, currentCount + 1);
                        continue;
                    }

                    uniqueTopics.add(topicName);
                }

                // Add partitioned topics
                for (const topic of partitionedTopics) {
                    const topicName = this.extractTopicName(topic);
                    uniqueTopics.add(topicName);
                }

                if (uniqueTopics.size === 0) {
                    return [this.createEmptyItem('No topics') as PulsarTreeItem];
                }

                const topicNodes: TopicNode[] = [];
                for (const topicName of Array.from(uniqueTopics).sort()) {
                    const partitions = topicPartitions.get(topicName) || 0;
                    const isPersistent = true; // Default to persistent
                    topicNodes.push(new TopicNode(topicName, clusterName, tenant, namespace, partitions, isPersistent));
                }

                return topicNodes;
            },
            'Loading topics'
        );
    }

    /**
     * Get children of a topic (subscriptions container, partitions)
     */
    private async getTopicChildrenNodes(topic: TopicNode): Promise<PulsarTreeItem[]> {
        const children: PulsarTreeItem[] = [];

        // Add subscriptions container
        children.push(new SubscriptionsContainerNode(
            topic.clusterName,
            topic.tenant!,
            topic.namespace!,
            topic.topicName!
        ));

        // Add partition nodes if partitioned
        if (topic.partitions > 0) {
            for (let i = 0; i < topic.partitions; i++) {
                children.push(new PartitionNode(
                    i,
                    topic.clusterName,
                    topic.tenant!,
                    topic.namespace!,
                    topic.topicName!
                ));
            }
        }

        return children;
    }

    /**
     * Get subscription nodes for a topic
     */
    private async getSubscriptionNodes(container: SubscriptionsContainerNode): Promise<PulsarTreeItem[]> {
        return this.getChildrenSafely(
            undefined,
            async () => {
                const fullTopic = `persistent://${container.tenant}/${container.namespace}/${container.topicName}`;
                const subscriptions = await this.clientManager.getSubscriptions(container.clusterName, fullTopic);

                if (subscriptions.length === 0) {
                    return [this.createEmptyItem('No subscriptions') as PulsarTreeItem];
                }

                // Get stats for subscription details
                const stats = await this.clientManager.getTopicStats(container.clusterName, fullTopic).catch(() => null);

                return subscriptions
                    .sort((a, b) => a.localeCompare(b))
                    .map(sub => {
                        const subStats = stats?.subscriptions[sub];
                        return new SubscriptionNode(
                            sub,
                            container.clusterName,
                            container.tenant!,
                            container.namespace!,
                            container.topicName,
                            subStats?.type,
                            subStats?.msgBacklog
                        );
                    });
            },
            'Loading subscriptions'
        );
    }

    /**
     * Extract topic name from full topic path
     */
    private extractTopicName(fullTopic: string): string {
        // Format: persistent://tenant/namespace/topic or non-persistent://tenant/namespace/topic
        const match = fullTopic.match(/^(?:persistent|non-persistent):\/\/[^/]+\/[^/]+\/(.+)$/);
        if (match) {
            return match[1];
        }
        // Already just the topic name
        return fullTopic.split('/').pop() || fullTopic;
    }
}
