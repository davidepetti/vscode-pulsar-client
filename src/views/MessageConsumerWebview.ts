import * as vscode from 'vscode';
import WebSocket from 'ws';
import { Logger } from '../infrastructure/Logger';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';

interface ConsumerState {
    messageCount: number;
    isConnected: boolean;
    isPaused: boolean;
    subscription: string;
    keyFilter: string;
    keyFilterMode: 'exact' | 'regex';
    autoStopOnMatch: boolean;
}

interface PulsarMessage {
    messageId: string;
    payload: string;
    publishTime: string;
    properties: Record<string, string>;
    key?: string;
    redeliveryCount?: number;
}

/**
 * WebView panel for consuming messages from a Pulsar topic
 */
export class MessageConsumerWebview {
    private static instance: MessageConsumerWebview | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getLogger('MessageConsumerWebview');
    private ws: WebSocket | undefined;
    private consumerState: ConsumerState = {
        messageCount: 0,
        isConnected: false,
        isPaused: false,
        subscription: '',
        keyFilter: '',
        keyFilterMode: 'exact',
        autoStopOnMatch: false
    };

    private clusterName: string = '';
    private tenant: string = '';
    private namespace: string = '';
    private topicName: string = '';
    private messages: PulsarMessage[] = [];
    private compiledKeyFilterRegex: RegExp | undefined;
    private partitionCount: number = 0;

    private constructor(private clientManager: PulsarClientManager) {}

    public static getInstance(clientManager: PulsarClientManager): MessageConsumerWebview {
        if (!MessageConsumerWebview.instance) {
            MessageConsumerWebview.instance = new MessageConsumerWebview(clientManager);
        }
        return MessageConsumerWebview.instance;
    }

    public async show(clusterName: string, tenant: string, namespace: string, topicName: string): Promise<void> {
        this.clusterName = clusterName;
        this.tenant = tenant;
        this.namespace = namespace;
        this.topicName = topicName;
        this.messages = [];
        this.consumerState = {
            messageCount: 0,
            isConnected: false,
            isPaused: false,
            subscription: '',
            keyFilter: '',
            keyFilterMode: 'exact',
            autoStopOnMatch: false
        };

        // Check if topic is partitioned
        this.partitionCount = 0;
        try {
            const fullTopic = `persistent://${tenant}/${namespace}/${topicName}`;
            const metadata = await this.clientManager.getTopicMetadata(clusterName, fullTopic);
            this.partitionCount = metadata.partitions || 0;
            this.logger.info(`Topic has ${this.partitionCount} partitions`);
        } catch (error) {
            this.logger.debug('Failed to get partition count, assuming non-partitioned topic', error);
            this.partitionCount = 0;
        }

        // Close existing WebSocket if any
        this.closeWebSocket();

        if (this.panel) {
            this.panel.title = `Consumer: ${topicName}`;
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pulsarMessageConsumer',
                `Consumer: ${topicName}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            this.panel.onDidDispose(() => {
                this.closeWebSocket();
                this.panel = undefined;
            });

            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleMessage(message);
            });
        }

        this.panel.webview.html = this.getHtmlContent();
    }

    private async connectWebSocket(subscription: string, position: 'latest' | 'earliest' = 'latest', partition?: number): Promise<void> {
        const connection = this.clientManager.getClusterConnection(this.clusterName);
        if (!connection) {
            this.postMessage({ command: 'error', message: 'Cluster connection not found' });
            return;
        }

        this.consumerState.subscription = subscription;

        // Build WebSocket URL with initial position
        // Format: ws://host:port/ws/v2/consumer/persistent/tenant/namespace/topic/subscription?subscriptionType=Exclusive&initialPosition=Latest
        // For partitioned topics: ws://host:port/ws/v2/consumer/persistent/tenant/namespace/topic-partition-N/subscription
        const baseUrl = connection.webServiceUrl.replace(/^http/, 'ws');
        const initialPosition = position === 'earliest' ? 'Earliest' : 'Latest';

        let topicPath = this.topicName;
        if (partition !== undefined && partition >= 0) {
            topicPath = `${this.topicName}-partition-${partition}`;
        }

        const wsUrl = `${baseUrl}/ws/v2/consumer/persistent/${this.tenant}/${this.namespace}/${topicPath}/${subscription}?initialPosition=${initialPosition}`;

        this.logger.info(`Connecting to WebSocket: ${wsUrl}`);

        try {
            const wsOptions: WebSocket.ClientOptions = {};
            if (connection.authToken) {
                wsOptions.headers = { 'Authorization': `Bearer ${connection.authToken}` };
            }
            this.ws = new WebSocket(wsUrl, wsOptions);

            this.ws.on('open', () => {
                this.logger.info('Consumer WebSocket connected');
                this.consumerState.isConnected = true;
                this.postMessage({ command: 'connected', subscription });
                this.updateStatus();
            });

            this.ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());

                    if (response.messageId) {
                        // This is a message
                        const message: PulsarMessage = {
                            messageId: response.messageId,
                            payload: this.decodePayload(response.payload),
                            publishTime: response.publishTime || new Date().toISOString(),
                            properties: response.properties || {},
                            key: response.key,
                            redeliveryCount: response.redeliveryCount
                        };

                        this.messages.unshift(message);
                        // Keep only last 100 messages
                        if (this.messages.length > 100) {
                            this.messages.pop();
                        }

                        this.consumerState.messageCount++;

                        // Check if message matches key filter (only relevant when filter is active)
                        const hasActiveFilter = !!this.consumerState.keyFilter;
                        const matchesFilter = hasActiveFilter && this.matchesKeyFilter(message.key);
                        const shouldHide = hasActiveFilter && !matchesFilter;

                        this.postMessage({
                            command: 'messageReceived',
                            message,
                            count: this.consumerState.messageCount,
                            shouldHide
                        });

                        // Send acknowledgment
                        this.acknowledgeMessage(response.messageId);

                        // Auto-stop if match found and auto-stop is enabled
                        if (matchesFilter && this.consumerState.autoStopOnMatch) {
                            this.logger.info('Key filter match found, auto-stopping consumer');
                            this.postMessage({
                                command: 'autoStopped',
                                message: `Found matching message with key: ${message.key || '(no key)'}`
                            });
                            this.closeWebSocket();
                        }
                    } else if (response.result === 'ok') {
                        // Acknowledgment response
                        this.logger.debug('Message acknowledged');
                    } else if (response.errorMsg) {
                        this.postMessage({
                            command: 'error',
                            message: response.errorMsg
                        });
                    }
                    this.updateStatus();
                } catch (e) {
                    this.logger.error('Failed to parse WebSocket message', e);
                }
            });

            this.ws.on('error', (error) => {
                this.logger.error('WebSocket error', error);
                this.consumerState.isConnected = false;
                this.postMessage({
                    command: 'error',
                    message: `WebSocket error: ${error.message}`
                });
                this.updateStatus();
            });

            this.ws.on('close', () => {
                this.logger.info('WebSocket closed');
                this.consumerState.isConnected = false;
                this.postMessage({ command: 'disconnected' });
                this.updateStatus();
            });

        } catch (error: any) {
            this.logger.error('Failed to connect WebSocket', error);
            this.postMessage({
                command: 'error',
                message: `Failed to connect: ${error.message}`
            });
        }
    }

    private decodePayload(payload: string): string {
        try {
            // Pulsar sends payload as base64
            const decoded = Buffer.from(payload, 'base64').toString('utf-8');
            // Try to parse as JSON for pretty printing
            try {
                const json = JSON.parse(decoded);
                return JSON.stringify(json, null, 2);
            } catch {
                return decoded;
            }
        } catch {
            return payload;
        }
    }

    private matchesKeyFilter(messageKey: string | undefined): boolean {
        // If no filter is set, return false (no messages should be highlighted/hidden)
        if (!this.consumerState.keyFilter) {
            return false;
        }

        // If message has no key and filter is set, it doesn't match
        if (!messageKey) {
            return false;
        }

        if (this.consumerState.keyFilterMode === 'exact') {
            return messageKey === this.consumerState.keyFilter;
        } else {
            // Regex mode - use pre-compiled regex
            if (!this.compiledKeyFilterRegex) {
                return false;
            }
            return this.compiledKeyFilterRegex.test(messageKey);
        }
    }

    private acknowledgeMessage(messageId: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ messageId }));
        }
    }

    private closeWebSocket(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'connect':
                await this.connectWebSocket(message.subscription, message.position || 'latest', message.partition);
                break;
            case 'disconnect':
                this.closeWebSocket();
                break;
            case 'getStatus':
                this.updateStatus();
                break;
            case 'clearMessages':
                this.messages = [];
                this.postMessage({ command: 'messagesCleared' });
                break;
            case 'exportMessages':
                await this.exportMessages(message.messages);
                break;
            case 'setKeyFilter':
                this.consumerState.keyFilter = message.keyFilter || '';
                this.consumerState.keyFilterMode = message.keyFilterMode || 'exact';
                this.consumerState.autoStopOnMatch = message.autoStopOnMatch || false;

                // Pre-compile regex if in regex mode
                if (this.consumerState.keyFilter && this.consumerState.keyFilterMode === 'regex') {
                    try {
                        this.compiledKeyFilterRegex = new RegExp(this.consumerState.keyFilter);
                        this.logger.info(`Key filter updated: ${this.consumerState.keyFilter} (mode: ${this.consumerState.keyFilterMode}, autoStop: ${this.consumerState.autoStopOnMatch})`);
                    } catch (e) {
                        this.logger.warn(`Invalid regex pattern: ${this.consumerState.keyFilter}`, e);
                        this.compiledKeyFilterRegex = undefined;
                        this.consumerState.keyFilter = ''; // Clear invalid filter
                    }
                } else {
                    this.compiledKeyFilterRegex = undefined;
                    this.logger.info(`Key filter updated: ${this.consumerState.keyFilter} (mode: ${this.consumerState.keyFilterMode}, autoStop: ${this.consumerState.autoStopOnMatch})`);
                }
                break;
        }
    }

    private async exportMessages(messages: any[]): Promise<void> {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`pulsar-messages-${this.topicName}-${Date.now()}.json`),
                filters: { 'JSON': ['json'] }
            });
            if (uri) {
                const content = JSON.stringify({
                    topic: `persistent://${this.tenant}/${this.namespace}/${this.topicName}`,
                    cluster: this.clusterName,
                    exportedAt: new Date().toISOString(),
                    messageCount: messages.length,
                    messages: messages
                }, null, 2);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
                vscode.window.showInformationMessage(`Exported ${messages.length} messages to ${uri.fsPath}`);
            }
        } catch (error: any) {
            this.logger.error('Failed to export messages', error);
            vscode.window.showErrorMessage(`Failed to export: ${error.message}`);
        }
    }

    private updateStatus(): void {
        this.postMessage({
            command: 'status',
            isConnected: this.consumerState.isConnected,
            messageCount: this.consumerState.messageCount,
            subscription: this.consumerState.subscription
        });
    }

    private postMessage(message: any): void {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    private getHtmlContent(): string {
        const fullTopic = `persistent://${this.tenant}/${this.namespace}/${this.topicName}`;
        const isPartitioned = this.partitionCount > 0;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Consumer: ${this.topicName}</title>
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
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h2 {
            margin: 0 0 5px 0;
            color: var(--vscode-foreground);
        }
        .topic-name {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: monospace;
        }
        .connection-form {
            margin-bottom: 20px;
            padding: 15px;
            background: var(--vscode-input-background);
            border-radius: 4px;
        }
        .form-row {
            display: flex;
            gap: 10px;
            align-items: center;
        }
        .form-row label {
            min-width: 100px;
        }
        .form-row input {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .status-bar {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            padding: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
        }
        .status-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .status-dot.connected {
            background: #4caf50;
        }
        .status-dot.disconnected {
            background: #f44336;
        }
        .button-row {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: inherit;
        }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.danger {
            background: #d32f2f;
            color: white;
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .messages-container {
            margin-top: 20px;
        }
        .messages-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .messages-header h3 {
            margin: 0;
        }
        .message-list {
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }
        .message-item {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .message-item:last-child {
            border-bottom: none;
        }
        .message-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .message-item.filter-hidden {
            display: none;
        }
        .message-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .message-id {
            font-family: monospace;
        }
        .message-key {
            color: var(--vscode-textLink-foreground);
        }
        .message-payload {
            font-family: monospace;
            font-size: 12px;
            background: var(--vscode-editor-background);
            padding: 8px;
            border-radius: 4px;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 200px;
            overflow-y: auto;
        }
        .message-properties {
            margin-top: 5px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .property-tag {
            display: inline-block;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 3px;
            margin-right: 5px;
            margin-top: 3px;
        }
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .filter-input {
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
            width: 200px;
        }
        .filter-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .message-item.hidden {
            display: none;
        }
        .filter-count {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-left: 10px;
        }
        .message-actions {
            display: flex;
            gap: 5px;
            margin-top: 8px;
        }
        .message-actions button {
            padding: 3px 8px;
            font-size: 11px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .message-actions button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .copy-success {
            color: #4caf50 !important;
        }
        .log-area {
            margin-top: 20px;
            padding: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            max-height: 150px;
            overflow-y: auto;
        }
        .log-item {
            padding: 3px 0;
            font-size: 12px;
            font-family: monospace;
        }
        .log-item.error {
            color: var(--vscode-errorForeground);
        }
        .log-item.success {
            color: #4caf50;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Message Consumer</h2>
        <div class="topic-name">${fullTopic}</div>
    </div>

    <div class="connection-form" id="connectionForm">
        <div class="form-row">
            <label for="subscriptionName">Subscription:</label>
            <input type="text" id="subscriptionName" placeholder="Enter subscription name..." value="vscode-consumer">
        </div>
        <div class="form-row" style="margin-top: 10px;">
            <label for="initialPosition">Start from:</label>
            <select id="initialPosition" style="flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
                <option value="latest">Latest (new messages only)</option>
                <option value="earliest">Earliest (all messages)</option>
            </select>
        </div>
        ${isPartitioned ? `
        <div class="form-row" style="margin-top: 10px;">
            <label for="partition">Partition:</label>
            <select id="partition" style="flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
                ${Array.from({ length: this.partitionCount }, (_, i) => `<option value="${i}">Partition ${i}</option>`).join('')}
            </select>
        </div>
        ` : ''}
        <div class="form-row" style="margin-top: 10px;">
            <label for="keyFilter">Filter by key:</label>
            <input type="text" id="keyFilter" placeholder="Enter key or pattern..." style="flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
        </div>
        <div class="form-row" style="margin-top: 10px;">
            <label for="keyFilterMode">Match mode:</label>
            <select id="keyFilterMode" style="flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
                <option value="exact">Exact match</option>
                <option value="regex">Regex pattern</option>
            </select>
        </div>
        <div class="form-row" style="margin-top: 10px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
                <input type="checkbox" id="autoStopOnMatch" style="margin-right: 8px;">
                <span>Auto-stop when matching message is found</span>
            </label>
        </div>
        <div class="button-row">
            <button class="primary" id="connectButton" onclick="connect()">Start Consuming</button>
            <button class="danger" id="disconnectButton" onclick="disconnect()" style="display: none;">Stop</button>
        </div>
    </div>

    <div class="status-bar">
        <div class="status-item">
            <div class="status-dot" id="connectionStatus"></div>
            <span id="connectionText">Disconnected</span>
        </div>
        <div class="status-item">
            <span>Messages: <strong id="messageCount">0</strong></span>
        </div>
        <div class="status-item" id="subscriptionInfo" style="display: none;">
            <span>Subscription: <strong id="currentSubscription"></strong></span>
        </div>
    </div>

    <div class="messages-container">
        <div class="messages-header">
            <div style="display: flex; align-items: center;">
                <h3 style="margin: 0;">Received Messages</h3>
                <span class="filter-count" id="filterCount"></span>
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <input type="text" class="filter-input" id="filterInput" placeholder="Filter messages..." oninput="filterMessages()">
                <button class="secondary" onclick="clearFilter()" title="Clear filter">✕</button>
                <button class="secondary" onclick="exportMessages()" title="Export to JSON">Export</button>
                <button class="secondary" onclick="clearMessages()">Clear All</button>
            </div>
        </div>
        <div class="message-list" id="messageList">
            <div class="empty-state" id="emptyState">
                No messages yet. Connect to a subscription to start consuming.
            </div>
        </div>
    </div>

    <div class="log-area" id="logArea">
        <div class="log-item" style="color: var(--vscode-descriptionForeground);">Connection log...</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isConnected = false;

        function updateConnectionStatus(connected, subscription) {
            isConnected = connected;
            const dot = document.getElementById('connectionStatus');
            const text = document.getElementById('connectionText');
            const connectBtn = document.getElementById('connectButton');
            const disconnectBtn = document.getElementById('disconnectButton');
            const subInput = document.getElementById('subscriptionName');
            const posSelect = document.getElementById('initialPosition');
            const partitionSelect = document.getElementById('partition');
            const keyFilterInput = document.getElementById('keyFilter');
            const keyFilterModeSelect = document.getElementById('keyFilterMode');
            const autoStopCheckbox = document.getElementById('autoStopOnMatch');
            const subInfo = document.getElementById('subscriptionInfo');
            const currentSub = document.getElementById('currentSubscription');

            if (connected) {
                dot.className = 'status-dot connected';
                text.textContent = 'Connected';
                connectBtn.style.display = 'none';
                disconnectBtn.style.display = 'inline-block';
                subInput.disabled = true;
                posSelect.disabled = true;
                if (partitionSelect) partitionSelect.disabled = true;
                keyFilterInput.disabled = true;
                keyFilterModeSelect.disabled = true;
                autoStopCheckbox.disabled = true;
                subInfo.style.display = 'flex';
                currentSub.textContent = subscription;
            } else {
                dot.className = 'status-dot disconnected';
                text.textContent = 'Disconnected';
                connectBtn.style.display = 'inline-block';
                disconnectBtn.style.display = 'none';
                subInput.disabled = false;
                posSelect.disabled = false;
                if (partitionSelect) partitionSelect.disabled = false;
                keyFilterInput.disabled = false;
                keyFilterModeSelect.disabled = false;
                autoStopCheckbox.disabled = false;
                subInfo.style.display = 'none';
            }
        }

        function connect() {
            const subscription = document.getElementById('subscriptionName').value.trim();
            const position = document.getElementById('initialPosition').value;
            const keyFilter = document.getElementById('keyFilter').value.trim();
            const keyFilterMode = document.getElementById('keyFilterMode').value;
            const autoStopOnMatch = document.getElementById('autoStopOnMatch').checked;
            const partitionSelect = document.getElementById('partition');
            const partition = partitionSelect ? parseInt(partitionSelect.value) : undefined;

            if (!subscription) {
                addLog('Please enter a subscription name', 'error');
                return;
            }

            // Send filter settings to backend
            vscode.postMessage({
                command: 'setKeyFilter',
                keyFilter,
                keyFilterMode,
                autoStopOnMatch
            });

            let logMsg = 'Connecting to subscription: ' + subscription + ' (position: ' + position + ')';
            if (partition !== undefined) {
                logMsg += ', partition: ' + partition;
            }
            if (keyFilter) {
                logMsg += ', key filter: ' + keyFilter + ' (' + keyFilterMode + ')';
                if (autoStopOnMatch) {
                    logMsg += ', auto-stop enabled';
                }
            }
            addLog(logMsg, 'info');

            vscode.postMessage({ command: 'connect', subscription, position, partition });
        }

        function disconnect() {
            vscode.postMessage({ command: 'disconnect' });
        }

        function clearMessages() {
            vscode.postMessage({ command: 'clearMessages' });
            document.getElementById('messageList').innerHTML =
                '<div class="empty-state" id="emptyState">No messages yet. Connect to a subscription to start consuming.</div>';
            document.getElementById('filterInput').value = '';
            updateFilterCount();
        }

        function clearFilter() {
            document.getElementById('filterInput').value = '';
            filterMessages();
        }

        function filterMessages() {
            const filter = document.getElementById('filterInput').value.toLowerCase().trim();
            const items = document.querySelectorAll('.message-item');
            let visibleCount = 0;
            let totalCount = items.length;

            items.forEach(item => {
                if (!filter) {
                    item.classList.remove('hidden');
                    visibleCount++;
                } else {
                    const text = item.textContent.toLowerCase();
                    if (text.includes(filter)) {
                        item.classList.remove('hidden');
                        visibleCount++;
                    } else {
                        item.classList.add('hidden');
                    }
                }
            });

            updateFilterCount(filter ? visibleCount : null, totalCount);
        }

        function updateFilterCount(visible, total) {
            const countEl = document.getElementById('filterCount');
            if (visible !== null && visible !== undefined) {
                countEl.textContent = '(' + visible + ' of ' + total + ' shown)';
            } else {
                countEl.textContent = '';
            }
        }

        function addMessage(message, shouldHide) {
            const list = document.getElementById('messageList');
            const emptyState = document.getElementById('emptyState');
            if (emptyState) {
                emptyState.remove();
            }

            const item = document.createElement('div');
            item.className = 'message-item';
            if (shouldHide) {
                item.classList.add('filter-hidden');
            }

            let propertiesHtml = '';
            if (message.properties && Object.keys(message.properties).length > 0) {
                propertiesHtml = '<div class="message-properties">Properties: ';
                for (const [key, value] of Object.entries(message.properties)) {
                    propertiesHtml += '<span class="property-tag">' + escapeHtml(key) + ': ' + escapeHtml(value) + '</span>';
                }
                propertiesHtml += '</div>';
            }

            const keyHtml = message.key ? '<span class="message-key">Key: ' + escapeHtml(message.key) + '</span>' : '';

            const msgIndex = Date.now() + Math.random();
            item.setAttribute('data-payload', message.payload);
            item.setAttribute('data-msg-index', msgIndex);

            item.innerHTML = \`
                <div class="message-header">
                    <span class="message-id">\${escapeHtml(message.messageId)}</span>
                    <span>\${new Date(message.publishTime).toLocaleString()}</span>
                </div>
                \${keyHtml}
                <div class="message-payload">\${escapeHtml(message.payload)}</div>
                \${propertiesHtml}
                <div class="message-actions">
                    <button onclick="copyMessage(this)" title="Copy payload to clipboard">📋 Copy</button>
                </div>
            \`;

            list.insertBefore(item, list.firstChild);

            // Keep only last 100 messages in DOM
            while (list.children.length > 100) {
                list.removeChild(list.lastChild);
            }

            // Apply current filter to new message
            const filter = document.getElementById('filterInput').value.toLowerCase().trim();
            if (filter && !item.textContent.toLowerCase().includes(filter)) {
                item.classList.add('hidden');
            }
            filterMessages(); // Update filter count
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function copyMessage(btn) {
            const item = btn.closest('.message-item');
            const payload = item.getAttribute('data-payload');
            navigator.clipboard.writeText(payload).then(() => {
                const originalText = btn.textContent;
                btn.textContent = '✓ Copied!';
                btn.classList.add('copy-success');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copy-success');
                }, 1500);
            }).catch(err => {
                addLog('Failed to copy: ' + err.message, 'error');
            });
        }

        function exportMessages() {
            const items = document.querySelectorAll('.message-item');
            if (items.length === 0) {
                addLog('No messages to export', 'error');
                return;
            }
            const messages = [];
            items.forEach(item => {
                const payload = item.getAttribute('data-payload');
                const idEl = item.querySelector('.message-id');
                const timeEl = item.querySelector('.message-header span:last-child');
                messages.push({
                    messageId: idEl ? idEl.textContent : '',
                    payload: payload,
                    timestamp: timeEl ? timeEl.textContent : ''
                });
            });
            vscode.postMessage({ command: 'exportMessages', messages: messages.reverse() });
        }

        function addLog(message, type = 'info') {
            const log = document.getElementById('logArea');
            const item = document.createElement('div');
            item.className = 'log-item ' + type;
            const time = new Date().toLocaleTimeString();
            item.textContent = '[' + time + '] ' + message;
            log.insertBefore(item, log.firstChild);

            while (log.children.length > 50) {
                log.removeChild(log.lastChild);
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'connected':
                    updateConnectionStatus(true, message.subscription);
                    addLog('Connected to subscription: ' + message.subscription, 'success');
                    break;
                case 'disconnected':
                    updateConnectionStatus(false);
                    addLog('Disconnected', 'info');
                    break;
                case 'messageReceived':
                    addMessage(message.message, message.shouldHide);
                    document.getElementById('messageCount').textContent = message.count;
                    break;
                case 'autoStopped':
                    addLog(message.message, 'success');
                    updateConnectionStatus(false);
                    break;
                case 'error':
                    addLog(message.message, 'error');
                    break;
                case 'status':
                    updateConnectionStatus(message.isConnected, message.subscription);
                    document.getElementById('messageCount').textContent = message.messageCount;
                    break;
                case 'messagesCleared':
                    document.getElementById('messageCount').textContent = '0';
                    addLog('Messages cleared', 'info');
                    break;
            }
        });

        // Request initial status
        vscode.postMessage({ command: 'getStatus' });
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        this.closeWebSocket();
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
