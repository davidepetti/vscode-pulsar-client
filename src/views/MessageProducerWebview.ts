import * as vscode from 'vscode';
import WebSocket from 'ws';
import { Logger } from '../infrastructure/Logger';
import { PulsarClientManager } from '../pulsar/pulsarClientManager';

interface ProducerState {
    messageCount: number;
    lastMessageTime: number | null;
    errorCount: number;
    isConnected: boolean;
}

/**
 * WebView panel for producing messages to a Pulsar topic
 */
export class MessageProducerWebview {
    private static instance: MessageProducerWebview | undefined;
    private panel: vscode.WebviewPanel | undefined;
    private logger = Logger.getLogger('MessageProducerWebview');
    private ws: WebSocket | undefined;
    private producerState: ProducerState = {
        messageCount: 0,
        lastMessageTime: null,
        errorCount: 0,
        isConnected: false
    };

    private clusterName: string = '';
    private tenant: string = '';
    private namespace: string = '';
    private topicName: string = '';
    private context: vscode.ExtensionContext | undefined;
    private partitionCount: number = 0;
    private selectedPartition: number = 0;

    private constructor(private clientManager: PulsarClientManager) {}

    public setContext(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    public static getInstance(clientManager: PulsarClientManager): MessageProducerWebview {
        if (!MessageProducerWebview.instance) {
            MessageProducerWebview.instance = new MessageProducerWebview(clientManager);
        }
        return MessageProducerWebview.instance;
    }

    public async show(clusterName: string, tenant: string, namespace: string, topicName: string): Promise<void> {
        this.clusterName = clusterName;
        this.tenant = tenant;
        this.namespace = namespace;
        this.topicName = topicName;
        this.producerState = {
            messageCount: 0,
            lastMessageTime: null,
            errorCount: 0,
            isConnected: false
        };

        // Check if topic is partitioned
        this.partitionCount = 0;
        this.selectedPartition = 0;
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
            this.panel.title = `Producer: ${topicName}`;
            this.panel.reveal(vscode.ViewColumn.One);
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pulsarMessageProducer',
                `Producer: ${topicName}`,
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

        // Connect to WebSocket
        await this.connectWebSocket();
    }

    private async connectWebSocket(): Promise<void> {
        const connection = this.clientManager.getClusterConnection(this.clusterName);
        if (!connection) {
            this.postMessage({ command: 'error', message: 'Cluster connection not found' });
            return;
        }

        // Build WebSocket URL
        // Format: ws://host:port/ws/v2/producer/persistent/tenant/namespace/topic
        // For partitioned topics: ws://host:port/ws/v2/producer/persistent/tenant/namespace/topic-partition-N
        const baseUrl = connection.webServiceUrl.replace(/^http/, 'ws');

        let topicPath = this.topicName;
        if (this.partitionCount > 0 && this.selectedPartition >= 0) {
            topicPath = `${this.topicName}-partition-${this.selectedPartition}`;
        }

        const wsUrl = `${baseUrl}/ws/v2/producer/persistent/${this.tenant}/${this.namespace}/${topicPath}`;

        this.logger.info(`Connecting to WebSocket: ${wsUrl}`);

        try {
            const wsOptions: WebSocket.ClientOptions = {};
            if (connection.authToken) {
                wsOptions.headers = { 'Authorization': `Bearer ${connection.authToken}` };
            }
            this.ws = new WebSocket(wsUrl, wsOptions);

            this.ws.on('open', () => {
                this.logger.info('WebSocket connected');
                this.producerState.isConnected = true;
                this.postMessage({ command: 'connected' });
                this.updateStatus();
            });

            this.ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data.toString());
                    if (response.result === 'ok') {
                        this.producerState.messageCount++;
                        this.producerState.lastMessageTime = Date.now();
                        this.postMessage({
                            command: 'messageSent',
                            messageId: response.messageId,
                            count: this.producerState.messageCount
                        });
                    } else {
                        this.producerState.errorCount++;
                        this.postMessage({
                            command: 'error',
                            message: response.errorMsg || 'Unknown error'
                        });
                    }
                    this.updateStatus();
                } catch (e) {
                    this.logger.error('Failed to parse WebSocket message', e);
                }
            });

            this.ws.on('error', (error) => {
                this.logger.error('WebSocket error', error);
                this.producerState.isConnected = false;
                this.producerState.errorCount++;
                this.postMessage({
                    command: 'error',
                    message: `WebSocket error: ${error.message}`
                });
                this.updateStatus();
            });

            this.ws.on('close', () => {
                this.logger.info('WebSocket closed');
                this.producerState.isConnected = false;
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

    private closeWebSocket(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = undefined;
        }
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'send':
                await this.sendMessage(message.payload, message.key, message.properties);
                break;
            case 'reconnect':
                await this.connectWebSocket();
                break;
            case 'selectPartition':
                this.selectedPartition = message.partition || 0;
                this.closeWebSocket();
                await this.connectWebSocket();
                break;
            case 'getStatus':
                this.updateStatus();
                this.sendTemplates();
                break;
            case 'saveTemplate':
                await this.saveTemplate(message.name, message.template);
                break;
            case 'deleteTemplate':
                await this.deleteTemplate(message.name);
                break;
            case 'loadTemplates':
                this.sendTemplates();
                break;
        }
    }

    private getTemplates(): Record<string, any> {
        if (!this.context) return {};
        return this.context.globalState.get('pulsar.messageTemplates', {});
    }

    private async saveTemplate(name: string, template: any): Promise<void> {
        if (!this.context) {
            this.postMessage({ command: 'error', message: 'Context not available' });
            return;
        }
        const templates = this.getTemplates();
        templates[name] = template;
        await this.context.globalState.update('pulsar.messageTemplates', templates);
        this.sendTemplates();
        this.postMessage({ command: 'templateSaved', name });
    }

    private async deleteTemplate(name: string): Promise<void> {
        if (!this.context) return;
        const templates = this.getTemplates();
        delete templates[name];
        await this.context.globalState.update('pulsar.messageTemplates', templates);
        this.sendTemplates();
    }

    private sendTemplates(): void {
        const templates = this.getTemplates();
        this.postMessage({ command: 'templates', templates });
    }

    private async sendMessage(payload: string, key?: string, properties?: Record<string, string>): Promise<void> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.postMessage({
                command: 'error',
                message: 'WebSocket not connected'
            });
            return;
        }

        try {
            // Pulsar WebSocket producer message format
            const message: any = {
                payload: Buffer.from(payload).toString('base64'),
                properties: properties || {},
                context: `msg-${Date.now()}`
            };

            if (key) {
                message.key = key;
            }

            this.ws.send(JSON.stringify(message));
        } catch (error: any) {
            this.logger.error('Failed to send message', error);
            this.postMessage({
                command: 'error',
                message: `Failed to send: ${error.message}`
            });
        }
    }

    private updateStatus(): void {
        this.postMessage({
            command: 'status',
            isConnected: this.producerState.isConnected,
            messageCount: this.producerState.messageCount,
            errorCount: this.producerState.errorCount,
            lastMessageTime: this.producerState.lastMessageTime
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
    <title>Producer: ${this.topicName}</title>
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
        .form-group {
            margin-bottom: 15px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }
        input, textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
        }
        textarea {
            min-height: 150px;
            font-family: monospace;
            resize: vertical;
        }
        input:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .button-row {
            display: flex;
            gap: 10px;
            margin-top: 20px;
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
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .messages {
            margin-top: 20px;
            padding: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
        }
        .message-item {
            padding: 5px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            font-family: monospace;
        }
        .message-item:last-child {
            border-bottom: none;
        }
        .message-item.error {
            color: var(--vscode-errorForeground);
        }
        .message-item.success {
            color: #4caf50;
        }
        .properties-section {
            margin-top: 10px;
        }
        .property-row {
            display: flex;
            gap: 10px;
            margin-bottom: 5px;
        }
        .property-row input {
            flex: 1;
        }
        .add-property {
            font-size: 12px;
            padding: 4px 8px;
        }
        .templates-section {
            margin-bottom: 20px;
            padding: 10px;
            background: var(--vscode-input-background);
            border-radius: 4px;
        }
        .templates-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .templates-header h4 {
            margin: 0;
            font-size: 12px;
            text-transform: uppercase;
            color: var(--vscode-descriptionForeground);
        }
        .template-select {
            flex: 1;
            padding: 6px;
            margin-right: 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        .template-actions {
            display: flex;
            gap: 5px;
        }
        .template-actions button {
            padding: 4px 8px;
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Message Producer</h2>
        <div class="topic-name">${fullTopic}</div>
    </div>

    <div class="status-bar">
        <div class="status-item">
            <div class="status-dot" id="connectionStatus"></div>
            <span id="connectionText">Connecting...</span>
        </div>
        <div class="status-item">
            <span>Messages: <strong id="messageCount">0</strong></span>
        </div>
        <div class="status-item">
            <span>Errors: <strong id="errorCount">0</strong></span>
        </div>
        ${isPartitioned ? `
        <div class="status-item">
            <label for="partitionSelect" style="margin-right: 5px;">Partition:</label>
            <select id="partitionSelect" onchange="selectPartition()" style="padding: 4px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
                ${Array.from({ length: this.partitionCount }, (_, i) => `<option value="${i}"${i === this.selectedPartition ? ' selected' : ''}>Partition ${i}</option>`).join('')}
            </select>
        </div>
        ` : ''}
    </div>

    <div class="templates-section">
        <div class="templates-header">
            <h4>Message Templates</h4>
        </div>
        <div style="display: flex; align-items: center;">
            <select id="templateSelect" class="template-select" onchange="loadTemplate()">
                <option value="">-- Select a template --</option>
            </select>
            <div class="template-actions">
                <button class="secondary" onclick="saveCurrentAsTemplate()" title="Save current message as template">Save</button>
                <button class="secondary" onclick="deleteSelectedTemplate()" title="Delete selected template">Delete</button>
            </div>
        </div>
    </div>

    <div class="form-group">
        <label for="messageKey">Message Key (optional)</label>
        <input type="text" id="messageKey" placeholder="Enter message key...">
    </div>

    <div class="form-group">
        <label for="messagePayload">Message Payload</label>
        <textarea id="messagePayload" placeholder='{"example": "Enter your message here..."}'></textarea>
    </div>

    <div class="form-group properties-section">
        <label>Properties (optional)</label>
        <div id="propertiesContainer"></div>
        <button class="secondary add-property" onclick="addProperty()">+ Add Property</button>
    </div>

    <div class="button-row">
        <button class="primary" id="sendButton" onclick="sendMessage()">Send Message</button>
        <button class="secondary" id="reconnectButton" onclick="reconnect()" style="display: none;">Reconnect</button>
    </div>

    <div class="messages" id="messagesLog">
        <div class="message-item" style="color: var(--vscode-descriptionForeground);">Message log will appear here...</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let isConnected = false;

        function updateConnectionStatus(connected) {
            isConnected = connected;
            const dot = document.getElementById('connectionStatus');
            const text = document.getElementById('connectionText');
            const sendBtn = document.getElementById('sendButton');
            const reconnectBtn = document.getElementById('reconnectButton');

            if (connected) {
                dot.className = 'status-dot connected';
                text.textContent = 'Connected';
                sendBtn.disabled = false;
                reconnectBtn.style.display = 'none';
            } else {
                dot.className = 'status-dot disconnected';
                text.textContent = 'Disconnected';
                sendBtn.disabled = true;
                reconnectBtn.style.display = 'inline-block';
            }
        }

        function sendMessage() {
            const payload = document.getElementById('messagePayload').value;
            const key = document.getElementById('messageKey').value;

            if (!payload.trim()) {
                addLog('Please enter a message payload', 'error');
                return;
            }

            const properties = getProperties();

            vscode.postMessage({
                command: 'send',
                payload: payload,
                key: key || undefined,
                properties: Object.keys(properties).length > 0 ? properties : undefined
            });
        }

        function reconnect() {
            vscode.postMessage({ command: 'reconnect' });
            document.getElementById('connectionText').textContent = 'Connecting...';
        }

        function selectPartition() {
            const partitionSelect = document.getElementById('partitionSelect');
            if (partitionSelect) {
                const partition = parseInt(partitionSelect.value);
                addLog('Switching to partition ' + partition + '...', 'info');
                vscode.postMessage({ command: 'selectPartition', partition });
            }
        }

        function getProperties() {
            const props = {};
            const rows = document.querySelectorAll('.property-row');
            rows.forEach(row => {
                const key = row.querySelector('.prop-key').value.trim();
                const value = row.querySelector('.prop-value').value.trim();
                if (key) {
                    props[key] = value;
                }
            });
            return props;
        }

        function addProperty() {
            const container = document.getElementById('propertiesContainer');
            const row = document.createElement('div');
            row.className = 'property-row';
            row.innerHTML = \`
                <input type="text" class="prop-key" placeholder="Key">
                <input type="text" class="prop-value" placeholder="Value">
                <button class="secondary" onclick="this.parentElement.remove()" style="padding: 4px 8px;">×</button>
            \`;
            container.appendChild(row);
        }

        function addLog(message, type = 'info') {
            const log = document.getElementById('messagesLog');
            const item = document.createElement('div');
            item.className = 'message-item ' + type;
            const time = new Date().toLocaleTimeString();
            item.textContent = '[' + time + '] ' + message;
            log.insertBefore(item, log.firstChild);

            // Limit log entries
            while (log.children.length > 50) {
                log.removeChild(log.lastChild);
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'connected':
                    updateConnectionStatus(true);
                    addLog('Connected to Pulsar', 'success');
                    break;
                case 'disconnected':
                    updateConnectionStatus(false);
                    addLog('Disconnected from Pulsar', 'error');
                    break;
                case 'messageSent':
                    addLog('Message sent successfully (ID: ' + message.messageId + ')', 'success');
                    document.getElementById('messageCount').textContent = message.count;
                    break;
                case 'error':
                    addLog(message.message, 'error');
                    document.getElementById('errorCount').textContent =
                        parseInt(document.getElementById('errorCount').textContent) + 1;
                    break;
                case 'status':
                    updateConnectionStatus(message.isConnected);
                    document.getElementById('messageCount').textContent = message.messageCount;
                    document.getElementById('errorCount').textContent = message.errorCount;
                    break;
                case 'templates':
                    updateTemplateSelect(message.templates);
                    break;
                case 'templateSaved':
                    addLog('Template saved: ' + message.name, 'success');
                    break;
            }
        });

        // Template functions
        let currentTemplates = {};

        function updateTemplateSelect(templates) {
            currentTemplates = templates;
            const select = document.getElementById('templateSelect');
            const currentValue = select.value;
            select.innerHTML = '<option value="">-- Select a template --</option>';
            for (const name of Object.keys(templates).sort()) {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            }
            if (currentValue && templates[currentValue]) {
                select.value = currentValue;
            }
        }

        function loadTemplate() {
            const select = document.getElementById('templateSelect');
            const name = select.value;
            if (!name || !currentTemplates[name]) return;

            const template = currentTemplates[name];
            document.getElementById('messagePayload').value = template.payload || '';
            document.getElementById('messageKey').value = template.key || '';

            // Clear existing properties
            document.getElementById('propertiesContainer').innerHTML = '';

            // Add template properties
            if (template.properties) {
                for (const [key, value] of Object.entries(template.properties)) {
                    addPropertyWithValues(key, value);
                }
            }
            addLog('Loaded template: ' + name, 'success');
        }

        function addPropertyWithValues(key, value) {
            const container = document.getElementById('propertiesContainer');
            const row = document.createElement('div');
            row.className = 'property-row';
            row.innerHTML = \`
                <input type="text" class="prop-key" placeholder="Key" value="\${escapeAttr(key)}">
                <input type="text" class="prop-value" placeholder="Value" value="\${escapeAttr(value)}">
                <button class="secondary" onclick="this.parentElement.remove()" style="padding: 4px 8px;">×</button>
            \`;
            container.appendChild(row);
        }

        function escapeAttr(str) {
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function saveCurrentAsTemplate() {
            const name = prompt('Enter template name:');
            if (!name || !name.trim()) return;

            const template = {
                payload: document.getElementById('messagePayload').value,
                key: document.getElementById('messageKey').value,
                properties: getProperties()
            };

            vscode.postMessage({ command: 'saveTemplate', name: name.trim(), template });
        }

        function deleteSelectedTemplate() {
            const select = document.getElementById('templateSelect');
            const name = select.value;
            if (!name) {
                addLog('Please select a template to delete', 'error');
                return;
            }
            if (confirm('Delete template "' + name + '"?')) {
                vscode.postMessage({ command: 'deleteTemplate', name });
            }
        }

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
