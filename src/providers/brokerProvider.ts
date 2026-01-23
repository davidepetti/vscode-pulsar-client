import * as vscode from 'vscode';
import { BaseProvider } from './BaseProvider';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import {
    PulsarTreeItem,
    ClusterNode,
    BrokerNode
} from '../types/nodes';

/**
 * Tree data provider for brokers view
 */
export class BrokerProvider extends BaseProvider<PulsarTreeItem> {

    constructor(clientManager: PulsarClientManager) {
        super(clientManager, 'BrokerProvider');
    }

    async getChildren(element?: PulsarTreeItem): Promise<PulsarTreeItem[]> {
        if (!element) {
            // Root level - show clusters
            return this.getClusterNodes();
        }

        if (element.contextValue === 'cluster') {
            return this.getBrokerNodes(element.clusterName);
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
     * Get broker nodes for a cluster
     */
    private async getBrokerNodes(clusterName: string): Promise<PulsarTreeItem[]> {
        return this.getChildrenSafely(
            undefined,
            async () => {
                const brokers = await this.clientManager.getBrokers(clusterName);

                if (brokers.length === 0) {
                    return [this.createEmptyItem('No brokers found') as PulsarTreeItem];
                }

                // First broker is typically the leader in standalone mode
                return brokers.map((broker, index) =>
                    new BrokerNode(broker, clusterName, index === 0)
                );
            },
            'Loading brokers'
        );
    }
}
