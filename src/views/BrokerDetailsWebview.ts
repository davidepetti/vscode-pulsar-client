import * as vscode from 'vscode';
import { Logger } from '../infrastructure/Logger';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';

interface BrokerInfo {
    address: string;
    clusterName: string;
    isLeader: boolean;
    stats: any | null;
}

/**
 * WebView panel for displaying broker details
 */
export class BrokerDetailsWebview {
    private static instance: BrokerDetailsWebview | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getLogger('BrokerDetailsWebview');

    private brokerAddress: string = '';
    private clusterName: string = '';
    private isLeader: boolean = false;
    private refreshInterval: NodeJS.Timeout | undefined;

    private constructor(private clientManager: PulsarClientManager) {}

    public static getInstance(clientManager: PulsarClientManager): BrokerDetailsWebview {
        if (!BrokerDetailsWebview.instance) {
            BrokerDetailsWebview.instance = new BrokerDetailsWebview(clientManager);
        }
        return BrokerDetailsWebview.instance;
    }

    public async show(brokerAddress: string, clusterName: string, isLeader: boolean = false): Promise<void> {
        this.brokerAddress = brokerAddress;
        this.clusterName = clusterName;
        this.isLeader = isLeader;

        // Clear existing refresh interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.panel) {
            this.panel.title = `Broker: ${brokerAddress}`;
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pulsarBrokerDetails',
                `Broker: ${brokerAddress}`,
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

        // Auto-refresh every 10 seconds
        this.refreshInterval = setInterval(() => {
            this.refreshData();
        }, 10000);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.refreshData();
                break;
            case 'copyAddress':
                await vscode.env.clipboard.writeText(this.brokerAddress);
                vscode.window.showInformationMessage('Broker address copied to clipboard');
                break;
        }
    }

    private async refreshData(): Promise<void> {
        try {
            let stats = null;
            try {
                stats = await this.clientManager.getBrokerStats(this.clusterName);
            } catch {
                // Stats not available on standalone
            }

            this.panel!.webview.html = this.getHtmlContent({
                address: this.brokerAddress,
                clusterName: this.clusterName,
                isLeader: this.isLeader,
                stats
            });
        } catch (error: any) {
            this.logger.error('Failed to refresh broker data', error);
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private formatNumber(num: number): string {
        if (num < 1000) return num.toString();
        if (num < 1000000) return (num / 1000).toFixed(1) + 'K';
        return (num / 1000000).toFixed(1) + 'M';
    }

    private getHtmlContent(info: BrokerInfo): string {
        // Extract stats if available
        const hasStats = info.stats !== null;

        // Build stats section
        let statsHtml = '';
        if (hasStats && typeof info.stats === 'object') {
            const statEntries = this.flattenObject(info.stats);
            for (const [key, value] of statEntries.slice(0, 20)) { // Limit to first 20 entries
                statsHtml += `
                    <tr>
                        <td>${this.escapeHtml(key)}</td>
                        <td>${this.escapeHtml(String(value))}</td>
                    </tr>
                `;
            }
        }

        if (!statsHtml) {
            statsHtml = `
                <tr>
                    <td colspan="2" class="empty">
                        <div class="info-box">
                            <strong>Statistics Not Available</strong>
                            <p>Detailed broker statistics are not available on this cluster.</p>
                            <p>This is normal for standalone Pulsar instances.</p>
                        </div>
                    </td>
                </tr>
            `;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Broker: ${this.brokerAddress}</title>
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
        .broker-address {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: monospace;
            cursor: pointer;
        }
        .broker-address:hover {
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
        .stat-value.success {
            color: #4caf50;
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
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            margin-left: 8px;
        }
        .badge-leader {
            background: #4caf50;
            color: white;
        }
        .badge-follower {
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
        .info-box {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            padding: 15px;
            border-radius: 4px;
            text-align: left;
        }
        .info-box strong {
            display: block;
            margin-bottom: 8px;
        }
        .info-box p {
            margin: 5px 0;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h2>Broker Details</h2>
            <div class="broker-address" onclick="copyAddress()" title="Click to copy">${this.escapeHtml(info.address)}</div>
        </div>
        <div class="header-right">
            <div class="auto-refresh">
                <div class="pulse"></div>
                Auto-refresh
            </div>
            <button onclick="refresh()">&#8635; Refresh</button>
        </div>
    </div>

    <div class="metadata">
        <div class="metadata-item">
            <strong>Cluster:</strong> ${this.escapeHtml(info.clusterName)}
        </div>
        <div class="metadata-item">
            <strong>Role:</strong>
            <span class="badge ${info.isLeader ? 'badge-leader' : 'badge-follower'}">
                ${info.isLeader ? 'Leader' : 'Follower'}
            </span>
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value success">Online</div>
            <div class="stat-label">Status</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${info.isLeader ? 'Yes' : 'No'}</div>
            <div class="stat-label">Leader</div>
        </div>
    </div>

    <div class="section">
        <h3>Broker Statistics</h3>
        <table>
            <thead>
                <tr>
                    <th>Property</th>
                    <th>Value</th>
                </tr>
            </thead>
            <tbody>
                ${statsHtml}
            </tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function copyAddress() {
            vscode.postMessage({ command: 'copyAddress' });
        }
    </script>
</body>
</html>`;
    }

    private flattenObject(obj: any, prefix: string = ''): [string, any][] {
        const entries: [string, any][] = [];

        for (const [key, value] of Object.entries(obj || {})) {
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (value === null || value === undefined) {
                continue;
            }

            if (typeof value === 'object' && !Array.isArray(value)) {
                entries.push(...this.flattenObject(value, fullKey));
            } else if (Array.isArray(value)) {
                entries.push([fullKey, `[${value.length} items]`]);
            } else {
                entries.push([fullKey, value]);
            }
        }

        return entries;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
