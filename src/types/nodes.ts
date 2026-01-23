import * as vscode from 'vscode';

/**
 * Base tree item for Pulsar explorer
 */
export class PulsarTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly clusterName: string,
        public readonly tenant?: string,
        public readonly namespace?: string,
        public readonly topicName?: string,
        public readonly subscriptionName?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
    }

    /**
     * Get the full topic name (persistent://tenant/namespace/topic)
     */
    getFullTopicName(): string | undefined {
        if (this.tenant && this.namespace && this.topicName) {
            return `persistent://${this.tenant}/${this.namespace}/${this.topicName}`;
        }
        return this.topicName;
    }

    /**
     * Get the namespace path (tenant/namespace)
     */
    getNamespacePath(): string | undefined {
        if (this.tenant && this.namespace) {
            return `${this.tenant}/${this.namespace}`;
        }
        return undefined;
    }
}

/**
 * Cluster node in the tree
 */
export class ClusterNode extends PulsarTreeItem {
    constructor(
        clusterName: string,
        public readonly webServiceUrl: string
    ) {
        super(
            clusterName,
            vscode.TreeItemCollapsibleState.Collapsed,
            'cluster',
            clusterName
        );
        this.iconPath = new vscode.ThemeIcon('server-environment');
        this.tooltip = `Cluster: ${clusterName}\nURL: ${webServiceUrl}`;
        this.description = webServiceUrl;
    }
}

/**
 * Tenant node in the tree
 */
export class TenantNode extends PulsarTreeItem {
    constructor(
        tenantName: string,
        clusterName: string
    ) {
        super(
            tenantName,
            vscode.TreeItemCollapsibleState.Collapsed,
            'tenant',
            clusterName,
            tenantName
        );
        this.iconPath = new vscode.ThemeIcon('home');
        this.tooltip = `Tenant: ${tenantName}`;
        this.description = 'tenant';
    }
}

/**
 * Namespace node in the tree
 */
export class NamespaceNode extends PulsarTreeItem {
    constructor(
        namespaceName: string,
        clusterName: string,
        tenant: string
    ) {
        super(
            namespaceName,
            vscode.TreeItemCollapsibleState.Collapsed,
            'namespace',
            clusterName,
            tenant,
            namespaceName
        );
        this.iconPath = new vscode.ThemeIcon('folder-library');
        this.tooltip = `Namespace: ${tenant}/${namespaceName}`;
        this.description = 'namespace';
    }
}

/**
 * Topic node in the tree
 */
export class TopicNode extends PulsarTreeItem {
    constructor(
        topicName: string,
        clusterName: string,
        tenant: string,
        namespace: string,
        public readonly partitions: number = 0,
        public readonly persistent: boolean = true
    ) {
        super(
            topicName,
            partitions > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
            'topic',
            clusterName,
            tenant,
            namespace,
            topicName
        );

        const prefix = persistent ? 'persistent' : 'non-persistent';
        this.iconPath = new vscode.ThemeIcon('symbol-event');
        this.tooltip = `${prefix}://${tenant}/${namespace}/${topicName}`;
        this.description = partitions > 0 ? `${partitions} partitions` : 'topic';
    }
}

/**
 * Partition node in the tree
 */
export class PartitionNode extends PulsarTreeItem {
    constructor(
        partitionIndex: number,
        clusterName: string,
        tenant: string,
        namespace: string,
        topicName: string
    ) {
        super(
            `Partition ${partitionIndex}`,
            vscode.TreeItemCollapsibleState.None,
            'partition',
            clusterName,
            tenant,
            namespace,
            `${topicName}-partition-${partitionIndex}`
        );
        this.iconPath = new vscode.ThemeIcon('symbol-number');
        this.tooltip = `Partition ${partitionIndex} of ${topicName}`;
    }
}

/**
 * Subscription node in the tree
 */
export class SubscriptionNode extends PulsarTreeItem {
    constructor(
        subscriptionName: string,
        clusterName: string,
        tenant: string,
        namespace: string,
        topicName: string,
        public readonly subscriptionType?: string,
        public readonly backlog?: number
    ) {
        super(
            subscriptionName,
            vscode.TreeItemCollapsibleState.None,
            'subscription',
            clusterName,
            tenant,
            namespace,
            topicName,
            subscriptionName
        );
        this.iconPath = this.getIconForType(subscriptionType);
        this.tooltip = `Subscription: ${subscriptionName}\nType: ${subscriptionType || 'Unknown'}`;
        this.description = backlog !== undefined ? `Backlog: ${backlog}` : subscriptionType;
    }

    private getIconForType(type?: string): vscode.ThemeIcon {
        switch (type?.toLowerCase()) {
            case 'exclusive':
                return new vscode.ThemeIcon('person');
            case 'shared':
                return new vscode.ThemeIcon('people');
            case 'failover':
                return new vscode.ThemeIcon('arrow-swap');
            case 'key_shared':
                return new vscode.ThemeIcon('key');
            default:
                return new vscode.ThemeIcon('mail');
        }
    }
}

/**
 * Broker node in the tree
 */
export class BrokerNode extends PulsarTreeItem {
    constructor(
        brokerAddress: string,
        clusterName: string,
        public readonly isLeader: boolean = false
    ) {
        super(
            brokerAddress,
            vscode.TreeItemCollapsibleState.None,
            'broker',
            clusterName
        );
        this.iconPath = new vscode.ThemeIcon(isLeader ? 'star-full' : 'server');
        this.tooltip = `Broker: ${brokerAddress}${isLeader ? ' (Leader)' : ''}`;
        this.description = isLeader ? 'Leader' : undefined;
    }
}

/**
 * Container nodes for organizing the tree
 */
export class ContainerNode extends PulsarTreeItem {
    constructor(
        label: string,
        contextValue: string,
        clusterName: string,
        tenant?: string,
        namespace?: string
    ) {
        super(
            label,
            vscode.TreeItemCollapsibleState.Collapsed,
            contextValue,
            clusterName,
            tenant,
            namespace
        );
    }
}

/**
 * Tenants container
 */
export class TenantsContainerNode extends ContainerNode {
    constructor(clusterName: string) {
        super('Tenants', 'tenantsContainer', clusterName);
        this.iconPath = new vscode.ThemeIcon('organization');
    }
}

/**
 * Brokers container
 */
export class BrokersContainerNode extends ContainerNode {
    constructor(clusterName: string) {
        super('Brokers', 'brokersContainer', clusterName);
        this.iconPath = new vscode.ThemeIcon('server');
    }
}

/**
 * Subscriptions container under a topic
 */
export class SubscriptionsContainerNode extends ContainerNode {
    constructor(
        clusterName: string,
        tenant: string,
        namespace: string,
        public readonly topicName: string
    ) {
        super('Subscriptions', 'subscriptionsContainer', clusterName, tenant, namespace);
        this.iconPath = new vscode.ThemeIcon('mail-read');
    }
}

/**
 * Action node for adding a namespace manually (when LIST_TENANTS permission is missing)
 */
export class AddNamespaceActionNode extends PulsarTreeItem {
    constructor(clusterName: string) {
        super(
            'Add Namespace...',
            vscode.TreeItemCollapsibleState.None,
            'addNamespaceAction',
            clusterName
        );
        this.iconPath = new vscode.ThemeIcon('add');
        this.tooltip = 'Your service account may not have permission to list all tenants. Click to manually add a namespace you have access to.';
        this.command = {
            command: 'pulsar.addNamespace',
            title: 'Add Namespace',
            arguments: [clusterName]
        };
    }
}

/**
 * Info node shown when user has limited permissions
 */
export class LimitedAccessInfoNode extends PulsarTreeItem {
    constructor(clusterName: string, message: string) {
        super(
            message,
            vscode.TreeItemCollapsibleState.None,
            'limitedAccessInfo',
            clusterName
        );
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        this.tooltip = 'Your service account has limited permissions. Some operations may not be available.';
    }
}
