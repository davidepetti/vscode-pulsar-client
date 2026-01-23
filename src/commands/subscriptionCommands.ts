import * as vscode from 'vscode';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from '../providers/pulsarExplorerProvider';
import { SubscriptionProvider } from '../providers/subscriptionProvider';
import { ErrorHandler } from '../infrastructure/ErrorHandler';
import { TopicNode, SubscriptionNode } from '../types/nodes';

/**
 * Create a new subscription
 */
export async function createSubscription(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    node: TopicNode
): Promise<void> {
    try {
        // Get subscription name
        const subscriptionName = await vscode.window.showInputBox({
            prompt: 'Enter subscription name',
            placeHolder: 'my-subscription',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Subscription name is required';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Subscription name can only contain letters, numbers, underscores, and hyphens';
                }
                return undefined;
            }
        });

        if (!subscriptionName) {
            return;
        }

        // Ask for initial position
        const position = await vscode.window.showQuickPick(
            [
                { label: 'Latest', description: 'Start from the newest messages', value: 'latest' as const },
                { label: 'Earliest', description: 'Start from the oldest messages', value: 'earliest' as const }
            ],
            {
                placeHolder: 'Select initial position',
                title: 'Subscription Position'
            }
        );

        if (!position) {
            return;
        }

        const fullTopic = node.getFullTopicName() || `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;

        // Create subscription with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Creating subscription ${subscriptionName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.createSubscription(
                    node.clusterName,
                    fullTopic,
                    subscriptionName.trim(),
                    position.value
                );
            }
        );

        explorerProvider.refresh();
        subscriptionProvider.refresh();

        vscode.window.showInformationMessage(`Subscription "${subscriptionName}" created successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Creating subscription');
    }
}

/**
 * Delete a subscription
 */
export async function deleteSubscription(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    node: SubscriptionNode
): Promise<void> {
    try {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete subscription "${node.subscriptionName}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        const fullTopic = `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;

        // Delete subscription with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Deleting subscription ${node.subscriptionName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.deleteSubscription(
                    node.clusterName,
                    fullTopic,
                    node.subscriptionName!,
                    true
                );
            }
        );

        explorerProvider.refresh();
        subscriptionProvider.refresh();

        vscode.window.showInformationMessage(`Subscription "${node.subscriptionName}" deleted.`);
    } catch (error) {
        ErrorHandler.handle(error, 'Deleting subscription');
    }
}

/**
 * Reset subscription to a position
 */
export async function resetSubscription(
    clientManager: PulsarClientManager,
    explorerProvider: PulsarExplorerProvider,
    subscriptionProvider: SubscriptionProvider,
    node: SubscriptionNode
): Promise<void> {
    try {
        const resetOption = await vscode.window.showQuickPick(
            [
                { label: 'Beginning', description: 'Reset to the beginning of the topic', value: 'earliest' },
                { label: 'Now', description: 'Reset to the current time', value: 'latest' },
                { label: 'Skip All', description: 'Skip all pending messages', value: 'skip' },
                { label: 'Custom Time', description: 'Reset to a specific time', value: 'custom' }
            ],
            {
                placeHolder: 'Select reset position',
                title: 'Reset Subscription'
            }
        );

        if (!resetOption) {
            return;
        }

        const fullTopic = `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;
        let timestamp: number;

        if (resetOption.value === 'earliest') {
            timestamp = 0;
        } else if (resetOption.value === 'latest') {
            timestamp = Date.now();
        } else if (resetOption.value === 'skip') {
            // Skip all messages
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Skipping all messages for ${node.subscriptionName}...`,
                    cancellable: false
                },
                async () => {
                    await clientManager.skipAllMessages(
                        node.clusterName,
                        fullTopic,
                        node.subscriptionName!
                    );
                }
            );

            explorerProvider.refresh();
            subscriptionProvider.refresh();
            vscode.window.showInformationMessage(`Skipped all messages for subscription "${node.subscriptionName}".`);
            return;
        } else {
            // Custom time
            const timeStr = await vscode.window.showInputBox({
                prompt: 'Enter timestamp (e.g., "2024-01-15T10:30:00Z" or Unix timestamp in ms)',
                placeHolder: new Date().toISOString(),
                validateInput: (value) => {
                    const ts = Date.parse(value) || parseInt(value, 10);
                    if (isNaN(ts)) {
                        return 'Invalid timestamp format';
                    }
                    return undefined;
                }
            });

            if (!timeStr) {
                return;
            }

            timestamp = Date.parse(timeStr) || parseInt(timeStr, 10);
        }

        // Reset subscription with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Resetting subscription ${node.subscriptionName}...`,
                cancellable: false
            },
            async () => {
                await clientManager.resetSubscription(
                    node.clusterName,
                    fullTopic,
                    node.subscriptionName!,
                    timestamp
                );
            }
        );

        explorerProvider.refresh();
        subscriptionProvider.refresh();

        vscode.window.showInformationMessage(`Subscription "${node.subscriptionName}" reset successfully!`);
    } catch (error) {
        ErrorHandler.handle(error, 'Resetting subscription');
    }
}

/**
 * Show subscription details
 */
export async function showSubscriptionDetails(
    clientManager: PulsarClientManager,
    node: SubscriptionNode
): Promise<void> {
    try {
        const fullTopic = `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;

        // Fetch subscription stats
        const stats = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Loading subscription details...',
                cancellable: false
            },
            async () => {
                return clientManager.getSubscriptionStats(node.clusterName, fullTopic, node.subscriptionName!);
            }
        );

        // Create output channel
        const outputChannel = vscode.window.createOutputChannel(`Pulsar: ${node.subscriptionName}`);
        outputChannel.clear();
        outputChannel.appendLine(`Subscription: ${node.subscriptionName}`);
        outputChannel.appendLine(`Topic: ${fullTopic}`);
        outputChannel.appendLine(`Cluster: ${node.clusterName}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Configuration ===');
        outputChannel.appendLine(`Type: ${stats.type}`);
        outputChannel.appendLine(`Durable: ${stats.isDurable}`);
        outputChannel.appendLine(`Replicated: ${stats.isReplicated}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Statistics ===');
        outputChannel.appendLine(`Message Rate Out: ${stats.msgRateOut.toFixed(2)} msg/s`);
        outputChannel.appendLine(`Throughput Out: ${(stats.msgThroughputOut / 1024).toFixed(2)} KB/s`);
        outputChannel.appendLine(`Message Backlog: ${stats.msgBacklog}`);
        outputChannel.appendLine(`Message Delayed: ${stats.msgDelayed}`);
        outputChannel.appendLine(`Unacked Messages: ${stats.unackedMessages}`);
        outputChannel.appendLine(`Blocked: ${stats.blockedSubscriptionOnUnackedMsgs}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('=== Consumers ===');
        if (stats.consumers.length === 0) {
            outputChannel.appendLine('No active consumers');
        } else {
            for (const consumer of stats.consumers) {
                outputChannel.appendLine(`  - ${consumer.consumerName} (${consumer.address})`);
                outputChannel.appendLine(`    Rate: ${consumer.msgRateOut.toFixed(2)} msg/s`);
                outputChannel.appendLine(`    Unacked: ${consumer.unackedMessages}`);
            }
        }
        outputChannel.show();
    } catch (error) {
        ErrorHandler.handle(error, 'Loading subscription details');
    }
}

/**
 * Peek messages from a subscription (view without consuming)
 */
export async function peekMessages(
    clientManager: PulsarClientManager,
    node: SubscriptionNode
): Promise<void> {
    try {
        const countStr = await vscode.window.showInputBox({
            prompt: 'How many messages to peek?',
            value: '10',
            validateInput: (value) => {
                const num = parseInt(value, 10);
                if (isNaN(num) || num < 1 || num > 100) {
                    return 'Enter a number between 1 and 100';
                }
                return undefined;
            }
        });

        if (!countStr) {
            return;
        }

        const count = parseInt(countStr, 10);
        const fullTopic = `persistent://${node.tenant}/${node.namespace}/${node.topicName}`;

        const messages = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Peeking ${count} messages from ${node.subscriptionName}...`,
                cancellable: false
            },
            async () => {
                return clientManager.peekMessages(node.clusterName, fullTopic, node.subscriptionName!, count);
            }
        );

        if (!messages || messages.length === 0) {
            vscode.window.showInformationMessage('No messages available to peek.');
            return;
        }

        // Display messages in output channel
        const outputChannel = vscode.window.createOutputChannel(`Pulsar Peek: ${node.subscriptionName}`);
        outputChannel.clear();
        outputChannel.appendLine(`Peeked ${messages.length} message(s) from subscription: ${node.subscriptionName}`);
        outputChannel.appendLine(`Topic: ${fullTopic}`);
        outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(60));

        messages.forEach((msg, index) => {
            outputChannel.appendLine('');
            outputChannel.appendLine(`--- Message ${index + 1} ---`);
            if (msg.messageId) {
                outputChannel.appendLine(`Message ID: ${msg.messageId}`);
            }
            if (msg.publishTime) {
                outputChannel.appendLine(`Publish Time: ${new Date(msg.publishTime).toISOString()}`);
            }
            if (msg.key) {
                outputChannel.appendLine(`Key: ${msg.key}`);
            }
            if (msg.properties && Object.keys(msg.properties).length > 0) {
                outputChannel.appendLine(`Properties: ${JSON.stringify(msg.properties)}`);
            }
            outputChannel.appendLine('');
            outputChannel.appendLine('Payload:');
            // Try to decode base64 payload
            let payload = msg.payload || msg.data || '';
            try {
                payload = Buffer.from(payload, 'base64').toString('utf-8');
                // Try to pretty-print JSON
                try {
                    payload = JSON.stringify(JSON.parse(payload), null, 2);
                } catch {
                    // Not JSON, keep as-is
                }
            } catch {
                // Not base64, keep as-is
            }
            outputChannel.appendLine(payload);
        });

        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(60));
        outputChannel.show();

    } catch (error) {
        ErrorHandler.handle(error, 'Peeking messages');
    }
}

/**
 * Find a subscription by name
 */
export async function findSubscription(
    clientManager: PulsarClientManager
): Promise<void> {
    try {
        const clusters = clientManager.getClusters();
        if (clusters.length === 0) {
            vscode.window.showInformationMessage('No clusters configured');
            return;
        }

        // Build list of all subscriptions
        const subItems: vscode.QuickPickItem[] = [];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Loading subscriptions...',
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
                                const fullTopic = `persistent://${tenant}/${namespace}/${topicName}`;
                                try {
                                    const subs = await clientManager.getSubscriptions(clusterName, fullTopic);
                                    for (const sub of subs) {
                                        subItems.push({
                                            label: sub,
                                            description: topicName,
                                            detail: `${tenant}/${namespace} @ ${clusterName}`
                                        });
                                    }
                                } catch {
                                    // Skip topics with errors
                                }
                            }
                        }
                    }
                }
            }
        );

        if (subItems.length === 0) {
            vscode.window.showInformationMessage('No subscriptions found');
            return;
        }

        const selected = await vscode.window.showQuickPick(subItems, {
            placeHolder: 'Search for a subscription...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            vscode.window.showInformationMessage(`Selected: ${selected.label} on ${selected.description}`);
        }
    } catch (error) {
        ErrorHandler.handle(error, 'Finding subscription');
    }
}
