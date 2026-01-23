import * as vscode from 'vscode';
import { Logger, LogLevel } from './infrastructure/Logger';
import { EventBus, PulsarEvents } from './infrastructure/EventBus';
import { CredentialManager } from './infrastructure/CredentialManager';
import { PulsarClientManager } from './pulsar/pulsarClientManager';
import { PulsarExplorerProvider } from './providers/pulsarExplorerProvider';
import { SubscriptionProvider } from './providers/subscriptionProvider';
import { BrokerProvider } from './providers/brokerProvider';

// Commands
import * as clusterCommands from './commands/clusterCommands';
import * as tenantCommands from './commands/tenantCommands';
import * as namespaceCommands from './commands/namespaceCommands';
import * as topicCommands from './commands/topicCommands';
import * as subscriptionCommands from './commands/subscriptionCommands';

// Types
import { ClusterNode, TenantNode, NamespaceNode, TopicNode, SubscriptionNode } from './types/nodes';

// Views
import { MessageProducerWebview } from './views/MessageProducerWebview';
import { MessageConsumerWebview } from './views/MessageConsumerWebview';
import { TopicDetailsWebview } from './views/TopicDetailsWebview';
import { ClusterDashboardWebview } from './views/ClusterDashboardWebview';
import { BrokerDetailsWebview } from './views/BrokerDetailsWebview';

// Global instances for cleanup
let eventBus: EventBus;
let credentialManager: CredentialManager;
let clientManager: PulsarClientManager;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const logger = Logger.getLogger('Extension');
    logger.info('Activating Pulsar Client extension...');

    // Initialize log level from configuration
    const config = vscode.workspace.getConfiguration('pulsar');
    const logLevel = config.get<string>('logLevel', 'info');
    Logger.setLevel(logLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO);

    // Initialize infrastructure
    eventBus = new EventBus();
    credentialManager = new CredentialManager(context.secrets);
    clientManager = new PulsarClientManager(credentialManager);

    // Initialize providers
    const pulsarExplorerProvider = new PulsarExplorerProvider(clientManager);
    const subscriptionProvider = new SubscriptionProvider(clientManager);
    const brokerProvider = new BrokerProvider(clientManager);

    // Register tree views
    const pulsarExplorerTreeView = vscode.window.createTreeView('pulsarExplorer', {
        treeDataProvider: pulsarExplorerProvider,
        showCollapseAll: true
    });

    const subscriptionsTreeView = vscode.window.createTreeView('pulsarSubscriptions', {
        treeDataProvider: subscriptionProvider,
        showCollapseAll: true
    });

    const brokersTreeView = vscode.window.createTreeView('pulsarBrokers', {
        treeDataProvider: brokerProvider,
        showCollapseAll: true
    });

    // Set up event listeners
    eventBus.on(PulsarEvents.CLUSTER_ADDED, () => {
        pulsarExplorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();
    });

    eventBus.on(PulsarEvents.CLUSTER_REMOVED, () => {
        pulsarExplorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();
    });

    eventBus.on(PulsarEvents.REFRESH_REQUESTED, () => {
        pulsarExplorerProvider.refresh();
        subscriptionProvider.refresh();
        brokerProvider.refresh();
    });

    // Load saved cluster configurations
    await clientManager.loadConfiguration();

    // Refresh views after loading configuration
    pulsarExplorerProvider.refresh();
    subscriptionProvider.refresh();
    brokerProvider.refresh();

    // Create status bar item (before commands so updateStatusBar is available)
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'pulsar.addCluster';
    const updateStatusBar = () => {
        const clusters = clientManager.getClusters();
        if (clusters.length === 0) {
            statusBarItem.text = '$(pulse) Pulsar: No clusters';
            statusBarItem.tooltip = 'Click to add a Pulsar cluster';
        } else {
            statusBarItem.text = `$(pulse) Pulsar: ${clusters.length} cluster${clusters.length > 1 ? 's' : ''}`;
            statusBarItem.tooltip = `Connected clusters: ${clusters.join(', ')}`;
        }
    };
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        // Cluster commands
        vscode.commands.registerCommand('pulsar.addCluster', async () => {
            await clusterCommands.addCluster(
                clientManager,
                pulsarExplorerProvider,
                subscriptionProvider,
                brokerProvider,
                credentialManager
            );
            updateStatusBar();
        }),
        vscode.commands.registerCommand('pulsar.removeCluster', async (node: ClusterNode) => {
            await clusterCommands.removeCluster(
                clientManager,
                pulsarExplorerProvider,
                subscriptionProvider,
                brokerProvider,
                node
            );
            updateStatusBar();
        }),
        vscode.commands.registerCommand('pulsar.refreshCluster', () =>
            clusterCommands.refreshCluster(
                pulsarExplorerProvider,
                subscriptionProvider,
                brokerProvider
            )
        ),
        vscode.commands.registerCommand('pulsar.testConnection', (node?: ClusterNode) =>
            clusterCommands.testConnection(clientManager, node)
        ),

        // Tenant commands
        vscode.commands.registerCommand('pulsar.createTenant', (node: ClusterNode) =>
            tenantCommands.createTenant(clientManager, pulsarExplorerProvider, node)
        ),
        vscode.commands.registerCommand('pulsar.deleteTenant', (node: TenantNode) =>
            tenantCommands.deleteTenant(clientManager, pulsarExplorerProvider, node)
        ),

        // Namespace commands
        vscode.commands.registerCommand('pulsar.createNamespace', (node: TenantNode) =>
            namespaceCommands.createNamespace(clientManager, pulsarExplorerProvider, node)
        ),
        vscode.commands.registerCommand('pulsar.deleteNamespace', (node: NamespaceNode) =>
            namespaceCommands.deleteNamespace(clientManager, pulsarExplorerProvider, node)
        ),

        // Topic commands
        vscode.commands.registerCommand('pulsar.createTopic', (node: NamespaceNode) =>
            topicCommands.createTopic(clientManager, pulsarExplorerProvider, node)
        ),
        vscode.commands.registerCommand('pulsar.deleteTopic', (node: TopicNode) =>
            topicCommands.deleteTopic(clientManager, pulsarExplorerProvider, node)
        ),
        vscode.commands.registerCommand('pulsar.showTopicDetails', (node: TopicNode) => {
            const details = TopicDetailsWebview.getInstance(clientManager);
            details.show(node.clusterName, node.tenant!, node.namespace!, node.topicName!);
        }),
        vscode.commands.registerCommand('pulsar.showTopicDashboard', (node: TopicNode) => {
            const details = TopicDetailsWebview.getInstance(clientManager);
            details.show(node.clusterName, node.tenant!, node.namespace!, node.topicName!);
        }),
        vscode.commands.registerCommand('pulsar.findTopic', () =>
            topicCommands.findTopic(clientManager, pulsarExplorerProvider)
        ),

        // Subscription commands
        vscode.commands.registerCommand('pulsar.createSubscription', (node: TopicNode) =>
            subscriptionCommands.createSubscription(
                clientManager,
                pulsarExplorerProvider,
                subscriptionProvider,
                node
            )
        ),
        vscode.commands.registerCommand('pulsar.deleteSubscription', (node: SubscriptionNode) =>
            subscriptionCommands.deleteSubscription(
                clientManager,
                pulsarExplorerProvider,
                subscriptionProvider,
                node
            )
        ),
        vscode.commands.registerCommand('pulsar.resetSubscription', (node: SubscriptionNode) =>
            subscriptionCommands.resetSubscription(
                clientManager,
                pulsarExplorerProvider,
                subscriptionProvider,
                node
            )
        ),
        vscode.commands.registerCommand('pulsar.showSubscriptionDetails', (node: SubscriptionNode) =>
            subscriptionCommands.showSubscriptionDetails(clientManager, node)
        ),
        vscode.commands.registerCommand('pulsar.peekMessages', (node: SubscriptionNode) =>
            subscriptionCommands.peekMessages(clientManager, node)
        ),
        vscode.commands.registerCommand('pulsar.findSubscription', () =>
            subscriptionCommands.findSubscription(clientManager)
        ),

        // Broker commands
        vscode.commands.registerCommand('pulsar.showBrokerDetails', async (node: any) => {
            const brokerDetails = BrokerDetailsWebview.getInstance(clientManager);
            brokerDetails.show(node.label, node.clusterName, node.isLeader);
        }),

        // Cluster dashboard
        vscode.commands.registerCommand('pulsar.showClusterDashboard', async (node: ClusterNode) => {
            const clusterDashboard = ClusterDashboardWebview.getInstance(clientManager);
            clusterDashboard.show(node.clusterName);
        }),

        // Producer command
        vscode.commands.registerCommand('pulsar.produceMessage', (node: TopicNode) => {
            const producer = MessageProducerWebview.getInstance(clientManager);
            producer.setContext(context);
            producer.show(node.clusterName, node.tenant!, node.namespace!, node.topicName!);
        }),

        // Consumer command
        vscode.commands.registerCommand('pulsar.consumeMessages', (node: TopicNode) => {
            const consumer = MessageConsumerWebview.getInstance(clientManager);
            consumer.show(node.clusterName, node.tenant!, node.namespace!, node.topicName!);
        })
    );

    // Register tree view disposables
    context.subscriptions.push(
        pulsarExplorerTreeView,
        subscriptionsTreeView,
        brokersTreeView,
        pulsarExplorerProvider,
        subscriptionProvider,
        brokerProvider
    );

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('pulsar.logLevel')) {
                const newLevel = vscode.workspace.getConfiguration('pulsar').get<string>('logLevel', 'info');
                Logger.setLevel(newLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO);
                logger.info(`Log level changed to: ${newLevel}`);
            }
        })
    );

    logger.info('Pulsar Client extension activated successfully!');
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    const logger = Logger.getLogger('Extension');
    logger.info('Deactivating Pulsar Client extension...');

    // Clean up resources
    if (clientManager) {
        await clientManager.dispose();
    }

    if (eventBus) {
        eventBus.removeAllListeners();
    }

    // Clear logger cache
    Logger.clearLoggers();

    logger.info('Pulsar Client extension deactivated.');
}
