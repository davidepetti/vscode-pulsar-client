import * as vscode from 'vscode';
import { Logger } from '../infrastructure/Logger';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';
import { TopicStats } from '../types/pulsar';

/**
 * WebView panel for displaying topic details and statistics
 */
export class TopicDetailsWebview {
    private static instance: TopicDetailsWebview | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getLogger('TopicDetailsWebview');

    private clusterName: string = '';
    private tenant: string = '';
    private namespace: string = '';
    private topicName: string = '';
    private refreshInterval: NodeJS.Timeout | undefined;

    private constructor(private clientManager: PulsarClientManager) {}

    public static getInstance(clientManager: PulsarClientManager): TopicDetailsWebview {
        if (!TopicDetailsWebview.instance) {
            TopicDetailsWebview.instance = new TopicDetailsWebview(clientManager);
        }
        return TopicDetailsWebview.instance;
    }

    public async show(clusterName: string, tenant: string, namespace: string, topicName: string): Promise<void> {
        this.clusterName = clusterName;
        this.tenant = tenant;
        this.namespace = namespace;
        this.topicName = topicName;

        // Clear existing refresh interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.panel) {
            this.panel.title = `Topic: ${topicName}`;
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pulsarTopicDetails',
                `Topic: ${topicName}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                }
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleMessage(message);
            });
        }

        // Initial load
        await this.refreshData();

        // Auto-refresh every 5 seconds
        this.refreshInterval = setInterval(() => {
            this.refreshData();
        }, 5000);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.refreshData();
                break;
            case 'copyTopicName':
                const fullTopic = `persistent://${this.tenant}/${this.namespace}/${this.topicName}`;
                await vscode.env.clipboard.writeText(fullTopic);
                vscode.window.showInformationMessage('Topic name copied to clipboard');
                break;
        }
    }

    private async refreshData(): Promise<void> {
        try {
            const fullTopic = `persistent://${this.tenant}/${this.namespace}/${this.topicName}`;

            const [stats, metadata] = await Promise.all([
                this.clientManager.getTopicStats(this.clusterName, fullTopic).catch(() => null),
                this.clientManager.getTopicMetadata(this.clusterName, fullTopic).catch(() => null)
            ]);

            this.panel!.webview.html = this.getHtmlContent(stats, metadata?.partitions || 0);
        } catch (error: any) {
            this.logger.error('Failed to refresh topic data', error);
            this.postMessage({ command: 'error', message: error.message });
        }
    }

    private postMessage(message: any): void {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private formatRate(rate: number): string {
        if (rate < 1) return rate.toFixed(2);
        if (rate < 1000) return rate.toFixed(1);
        return (rate / 1000).toFixed(2) + 'k';
    }

    private getHtmlContent(stats: TopicStats | null, partitions: number): string {
        const fullTopic = `persistent://${this.tenant}/${this.namespace}/${this.topicName}`;

        // Calculate totals
        const msgRateIn = stats?.msgRateIn || 0;
        const msgRateOut = stats?.msgRateOut || 0;
        const msgThroughputIn = stats?.msgThroughputIn || 0;
        const msgThroughputOut = stats?.msgThroughputOut || 0;
        const storageSize = stats?.storageSize || 0;
        const producers = stats?.publishers?.length || 0;
        const subscriptions = stats?.subscriptions ? Object.keys(stats.subscriptions).length : 0;
        const totalBacklog = stats?.subscriptions
            ? Object.values(stats.subscriptions).reduce((sum, sub) => sum + (sub.msgBacklog || 0), 0)
            : 0;

        // Build subscriptions table
        let subscriptionsHtml = '';
        if (stats?.subscriptions) {
            for (const [name, sub] of Object.entries(stats.subscriptions)) {
                subscriptionsHtml += `
                    <tr>
                        <td>${this.escapeHtml(name)}</td>
                        <td><span class="badge badge-${(sub.type || 'unknown').toLowerCase()}">${sub.type || 'Unknown'}</span></td>
                        <td class="${sub.msgBacklog > 0 ? 'warning' : ''}">${sub.msgBacklog || 0}</td>
                        <td>${sub.consumers?.length || 0}</td>
                        <td>${this.formatRate(sub.msgRateOut || 0)}/s</td>
                        <td>${this.formatRate(sub.msgRateExpired || 0)}/s</td>
                    </tr>
                `;
            }
        }

        if (!subscriptionsHtml) {
            subscriptionsHtml = '<tr><td colspan="6" class="empty">No subscriptions</td></tr>';
        }

        // Build producers table
        let producersHtml = '';
        if (stats?.publishers && stats.publishers.length > 0) {
            for (const pub of stats.publishers) {
                producersHtml += `
                    <tr>
                        <td>${this.escapeHtml(pub.producerName || 'Unknown')}</td>
                        <td>${this.formatRate(pub.msgRateIn || 0)}/s</td>
                        <td>${this.formatBytes(pub.msgThroughputIn || 0)}/s</td>
                        <td>${pub.averageMsgSize ? this.formatBytes(pub.averageMsgSize) : '-'}</td>
                    </tr>
                `;
            }
        }

        if (!producersHtml) {
            producersHtml = '<tr><td colspan="4" class="empty">No active producers</td></tr>';
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Topic: ${this.topicName}</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header-left h2 {
            margin: 0 0 5px 0;
            color: var(--vscode-foreground);
        }
        .topic-name {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: monospace;
            cursor: pointer;
        }
        .topic-name:hover {
            color: var(--vscode-textLink-foreground);
        }
        .header-right {
            display: flex;
            gap: 10px;
        }
        button {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: var(--vscode-input-background);
            padding: 15px;
            border-radius: 6px;
            text-align: center;
        }
        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: var(--vscode-foreground);
        }
        .stat-value.warning {
            color: var(--vscode-editorWarning-foreground);
        }
        .stat-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
            text-transform: uppercase;
        }
        .section {
            margin-bottom: 25px;
        }
        .section h3 {
            margin: 0 0 10px 0;
            font-size: 14px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .section-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-input-background);
            font-weight: 500;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            font-size: 11px;
        }
        tr:hover {
            background: var(--vscode-list-hoverBackground);
        }
        td.empty {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        td.warning {
            color: var(--vscode-editorWarning-foreground);
            font-weight: bold;
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }
        .badge-exclusive {
            background: #2196f3;
            color: white;
        }
        .badge-shared {
            background: #4caf50;
            color: white;
        }
        .badge-failover {
            background: #ff9800;
            color: white;
        }
        .badge-key_shared {
            background: #9c27b0;
            color: white;
        }
        .badge-unknown {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .auto-refresh {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .pulse {
            width: 8px;
            height: 8px;
            background: #4caf50;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .metadata {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .metadata-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h2>Topic Details</h2>
            <div class="topic-name" onclick="copyTopicName()" title="Click to copy">${fullTopic}</div>
        </div>
        <div class="header-right">
            <div class="auto-refresh">
                <div class="pulse"></div>
                Auto-refresh
            </div>
            <button onclick="refresh()">↻ Refresh</button>
        </div>
    </div>

    <div class="metadata">
        <div class="metadata-item">
            <strong>Cluster:</strong> ${this.escapeHtml(this.clusterName)}
        </div>
        <div class="metadata-item">
            <strong>Partitions:</strong> ${partitions > 0 ? partitions : 'Non-partitioned'}
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${producers}</div>
            <div class="stat-label">Producers</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${subscriptions}</div>
            <div class="stat-label">Subscriptions</div>
        </div>
        <div class="stat-card">
            <div class="stat-value ${totalBacklog > 0 ? 'warning' : ''}">${totalBacklog}</div>
            <div class="stat-label">Total Backlog</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${this.formatRate(msgRateIn)}/s</div>
            <div class="stat-label">Msg Rate In</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${this.formatRate(msgRateOut)}/s</div>
            <div class="stat-label">Msg Rate Out</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${this.formatBytes(storageSize)}</div>
            <div class="stat-label">Storage Size</div>
        </div>
    </div>

    <div class="section">
        <h3>Subscriptions <span class="section-badge">${subscriptions}</span></h3>
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Backlog</th>
                    <th>Consumers</th>
                    <th>Msg Rate</th>
                    <th>Expired Rate</th>
                </tr>
            </thead>
            <tbody>
                ${subscriptionsHtml}
            </tbody>
        </table>
    </div>

    <div class="section">
        <h3>Producers <span class="section-badge">${producers}</span></h3>
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Msg Rate</th>
                    <th>Throughput</th>
                    <th>Avg Msg Size</th>
                </tr>
            </thead>
            <tbody>
                ${producersHtml}
            </tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function copyTopicName() {
            vscode.postMessage({ command: 'copyTopicName' });
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        const div = { innerHTML: '' };
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
        return escaped;
    }

    public dispose(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
