import * as vscode from 'vscode';
import { Logger } from '../infrastructure/Logger';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';

interface ClusterStats {
    tenants: string[];
    brokers: string[];
    namespaceCount: number;
    topicCount: number;
    webServiceUrl: string;
    authMethod: string;
}

/**
 * WebView panel for displaying cluster dashboard
 */
export class ClusterDashboardWebview {
    private static instance: ClusterDashboardWebview | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getLogger('ClusterDashboardWebview');

    private clusterName: string = '';
    private refreshInterval: NodeJS.Timeout | undefined;

    private constructor(private clientManager: PulsarClientManager) {}

    public static getInstance(clientManager: PulsarClientManager): ClusterDashboardWebview {
        if (!ClusterDashboardWebview.instance) {
            ClusterDashboardWebview.instance = new ClusterDashboardWebview(clientManager);
        }
        return ClusterDashboardWebview.instance;
    }

    public async show(clusterName: string): Promise<void> {
        this.clusterName = clusterName;

        // Clear existing refresh interval
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.panel) {
            this.panel.title = `Cluster: ${clusterName}`;
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pulsarClusterDashboard',
                `Cluster: ${clusterName}`,
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
            case 'copyUrl':
                const connection = this.clientManager.getClusterConnection(this.clusterName);
                if (connection?.webServiceUrl) {
                    await vscode.env.clipboard.writeText(connection.webServiceUrl);
                    vscode.window.showInformationMessage('URL copied to clipboard');
                }
                break;
        }
    }

    private async refreshData(): Promise<void> {
        try {
            const connection = this.clientManager.getClusterConnection(this.clusterName);
            const stats = await this.gatherClusterStats();

            this.panel!.webview.html = this.getHtmlContent({
                ...stats,
                webServiceUrl: connection?.webServiceUrl || 'N/A',
                authMethod: connection?.authMethod || 'none'
            });
        } catch (error: any) {
            this.logger.error('Failed to refresh cluster data', error);
        }
    }

    private async gatherClusterStats(): Promise<Omit<ClusterStats, 'webServiceUrl' | 'authMethod'>> {
        const tenants = await this.clientManager.getTenants(this.clusterName).catch(() => []);
        const brokers = await this.clientManager.getBrokers(this.clusterName).catch(() => []);

        let namespaceCount = 0;
        let topicCount = 0;

        for (const tenant of tenants) {
            try {
                const namespaces = await this.clientManager.getNamespaces(this.clusterName, tenant);
                namespaceCount += namespaces.length;

                for (const ns of namespaces) {
                    try {
                        const topics = await this.clientManager.getTopics(this.clusterName, tenant, ns);
                        // Filter out partition topics
                        topicCount += topics.filter(t => !t.match(/-partition-\d+$/)).length;
                    } catch {
                        // Skip topics with errors
                    }
                }
            } catch {
                // Skip namespaces with errors
            }
        }

        return { tenants, brokers, namespaceCount, topicCount };
    }

    private getHtmlContent(stats: ClusterStats): string {
        // Build tenants list
        let tenantsHtml = '';
        if (stats.tenants.length > 0) {
            for (const tenant of stats.tenants) {
                tenantsHtml += `
                    <tr>
                        <td>${this.escapeHtml(tenant)}</td>
                    </tr>
                `;
            }
        } else {
            tenantsHtml = '<tr><td class="empty">No tenants found</td></tr>';
        }

        // Build brokers list
        let brokersHtml = '';
        if (stats.brokers.length > 0) {
            stats.brokers.forEach((broker, index) => {
                brokersHtml += `
                    <tr>
                        <td>
                            ${this.escapeHtml(broker)}
                            ${index === 0 ? '<span class="badge badge-leader">Leader</span>' : ''}
                        </td>
                    </tr>
                `;
            });
        } else {
            brokersHtml = '<tr><td class="empty">No brokers found</td></tr>';
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cluster: ${this.clusterName}</title>
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
        .cluster-url {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: monospace;
            cursor: pointer;
        }
        .cluster-url:hover {
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
        .badge-auth {
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
        .two-column {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        @media (max-width: 600px) {
            .two-column {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <h2>Cluster Dashboard</h2>
            <div class="cluster-url" onclick="copyUrl()" title="Click to copy">${this.escapeHtml(stats.webServiceUrl)}</div>
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
            <strong>Cluster:</strong> ${this.escapeHtml(this.clusterName)}
        </div>
        <div class="metadata-item">
            <strong>Auth:</strong> <span class="badge badge-auth">${this.escapeHtml(stats.authMethod)}</span>
        </div>
    </div>

    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value">${stats.tenants.length}</div>
            <div class="stat-label">Tenants</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.namespaceCount}</div>
            <div class="stat-label">Namespaces</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.topicCount}</div>
            <div class="stat-label">Topics</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${stats.brokers.length}</div>
            <div class="stat-label">Brokers</div>
        </div>
    </div>

    <div class="two-column">
        <div class="section">
            <h3>Tenants <span class="section-badge">${stats.tenants.length}</span></h3>
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                    </tr>
                </thead>
                <tbody>
                    ${tenantsHtml}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h3>Brokers <span class="section-badge">${stats.brokers.length}</span></h3>
            <table>
                <thead>
                    <tr>
                        <th>Address</th>
                    </tr>
                </thead>
                <tbody>
                    ${brokersHtml}
                </tbody>
            </table>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function copyUrl() {
            vscode.postMessage({ command: 'copyUrl' });
        }
    </script>
</body>
</html>`;
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
