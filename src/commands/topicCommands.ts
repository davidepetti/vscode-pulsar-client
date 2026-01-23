import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { NamespaceNode, TopicNode } from '../types/nodes';

/**
 * Create a new topic
 */
export async function createTopic(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: NamespaceNode
): Promise<void> {
    try {
        // Get topic name
        const topicName = await vscode.window.showInputBox({
            prompt: 'Enter topic name',
            placeHolder: 'my-topic',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Topic name is required';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Topic name can only contain letters, numbers, underscores, and hyphens';
                }
                return undefined;
            }
        });

        if (!topicName) {
            return;
        }

        // Ask for number of partitions
        const partitionsStr = await vscode.window.showInputBox({
            prompt: 'Enter number of partitions (0 for non-partitioned topic)',
            placeHolder: '0',
            value: '0',
            validateInput: (value) => {
                const num = parseInt(value, 10);
                if (isNaN(num) || num < 0) {
                    return 'Must be a non-negative integer';
                }
                return undefined;
            }
        });

        if (partitionsStr === undefined) {
            return;
        }

        const partitions = parseInt(partitionsStr, 10);

        // Create topic with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Creating topic ${topicName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.createTopic(
                    node.clusterName,
                    node.tenant!,
                    node.namespace!,
                    topicName.trim(),
                    partitions > 0 ? partitions : undefined
                );
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Topic "${topicName}" created successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Creating topic');
    }
}

/**
 * Delete a topic
 */
export async function deleteTopic(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider,
    node: TopicNode
): Promise<void> {
    try {
        const fullTopic = node.getFullTopicName() || node.topicName!;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete topic "${node.topicName}"?\n\nThis will also delete all subscriptions and messages.`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        // Delete topic with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Deleting topic ${node.topicName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.deleteTopic(node.clusterName, fullTopic, true);
            }
        );

        provider.refresh();

        vscode.window.showInformationMessage(`Topic "${node.topicName}" deleted.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Deleting topic');
    }
}

/**
 * Show topic details in a webview panel
 */
export async function showTopicDetails(
    clientManager: PulsarClientManager,
    node: TopicNode
): Promise<void> {
    try {
        const fullTopic = node.getFullTopicName() || `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;

        // Fetch topic stats
        const stats = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Loading topic details...',
                cancellable: false
            },
            async () => {
                return clientManager.getTopicStats(node.clusterName, fullTopic);
            }
        );

        // Create simple output channel for now
        const outputChannel = vscode.window.createOutputChannel(`Pulsar: ${node.topicName}`);
        outputChannel.clear();
        outputChannel.appendLine(`Topic: ${fullTopic}`);
        outputChannel.appendLine(`Cluster: ${node.clusterName}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Statistics ===');
        outputChannel.appendLine(`Message Rate In: ${stats.msgRateIn.toFixed(2)} msg/s`);
        outputChannel.appendLine(`Message Rate Out: ${stats.msgRateOut.toFixed(2)} msg/s`);
        outputChannel.appendLine(`Throughput In: ${(stats.msgThroughputIn / 1024).toFixed(2)} KB/s`);
        outputChannel.appendLine(`Throughput Out: ${(stats.msgThroughputOut / 1024).toFixed(2)} KB/s`);
        outputChannel.appendLine(`Average Message Size: ${stats.averageMsgSize.toFixed(2)} bytes`);
        outputChannel.appendLine(`Storage Size: ${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`);
        outputChannel.appendLine(`Backlog Size: ${stats.backlogSize}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Publishers ===');
        if (stats.publishers.length === 0) {
            outputChannel.appendLine('No active publishers');
        } else {
            for (const pub of stats.publishers) {
                outputChannel.appendLine(`  - ${pub.producerName} (${pub.address})`);
                outputChannel.appendLine(`    Rate: ${pub.msgRateIn.toFixed(2)} msg/s`);
            }
        }
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Subscriptions ===');
        const subNames = Object.keys(stats.subscriptions);
        if (subNames.length === 0) {
            outputChannel.appendLine('No subscriptions');
        } else {
            for (const subName of subNames) {
                const sub = stats.subscriptions[subName];
                outputChannel.appendLine(`  - ${subName} (${sub.type})`);
                outputChannel.appendLine(`    Backlog: ${sub.msgBacklog} messages`);
                outputChannel.appendLine(`    Consumers: ${sub.consumers.length}`);
            }
        }
        outputChannel.show();
    } catch (error) {
        ErrorHandler.handle(error, 'Loading topic details');
    }
}

/**
 * Find a topic by name
 */
export async function findTopic(
    clientManager: PulsarClientManager,
    provider: PulsarExplorerProvider
): Promise<void> {
    try {
        const clusters = clientManager.getClusters();
        if (clusters.length === 0) {
            vscode.window.showInformationMessage('No clusters configured');
            return;
        }

        // Build list of all topics
        const topicItems: vscode.QuickPickItem[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Loading topics...',
                cancellable: false
            },
            async () => {
                for (const clusterName of clusters) {
                    const tenants = await clientManager.getTenants(clusterName);
                    for (const tenant of tenants) {
                        const namespaces = await clientManager.getNamespaces(clusterName, tenant);
                        for (const namespace of namespaces) {
                            const topics = await clientManager.getTopics(clusterName, tenant, namespace);
                            for (const topic of topics) {
                                // Skip partition topics
                                if (topic.match(/-partition-\d+$/)) {
                                    continue;
                                }
                                const topicName = topic.split('/').pop() || topic;
                                topicItems.push({
                                    label: topicName,
                                    description: `${tenant}/${namespace}`,
                                    detail: clusterName
                                });
                            }
                        }
                    }
                }
            }
        );

        if (topicItems.length === 0) {
            vscode.window.showInformationMessage('No topics found');
            return;
        }

        const selected = await vscode.window.showQuickPick(topicItems, {
            placeHolder: 'Search for a topic...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            vscode.window.showInformationMessage(`Selected: ${selected.label} in ${selected.description}`);
        }
    } catch (error) {
        ErrorHandler.handle(error, 'Finding topic');
    }
}
