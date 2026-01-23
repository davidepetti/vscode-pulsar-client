/**
 * Pulsar cluster connection configuration
 */
export interface PulsarClusterConnection {
    name: string;
    type: 'pulsar' | 'streamnative';

    // Connection URLs
    webServiceUrl: string;        // http://localhost:8080
    serviceUrl?: string;          // pulsar://localhost:6650 (for WebSocket)

    // Authentication
    authMethod: 'none' | 'token' | 'oauth2' | 'tls';
    authToken?: string;

    // OAuth2 (StreamNative Cloud)
    oauth2IssuerUrl?: string;
    oauth2Audience?: string;
    oauth2PrivateKey?: string;
    oauth2ClientId?: string;

    // TLS
    tlsTrustCertsFilePath?: string;
    tlsAllowInsecure?: boolean;
}

/**
 * Cluster information from Pulsar Admin API
 */
export interface ClusterInfo {
    serviceUrl?: string;
    serviceUrlTls?: string;
    brokerServiceUrl?: string;
    brokerServiceUrlTls?: string;
    proxyServiceUrl?: string;
    proxyProtocol?: string;
    peerClusterNames?: string[];
}

/**
 * Tenant configuration
 */
export interface TenantInfo {
    adminRoles?: string[];
    allowedClusters?: string[];
}

/**
 * Namespace policies
 */
export interface NamespacePolicies {
    bundles?: {
        boundaries?: string[];
        numBundles?: number;
    };
    replication_clusters?: string[];
    retention_policies?: {
        retentionTimeInMinutes?: number;
        retentionSizeInMB?: number;
    };
    schema_validation_enforced?: boolean;
    deduplicationEnabled?: boolean;
    message_ttl_in_seconds?: number;
    max_producers_per_topic?: number;
    max_consumers_per_topic?: number;
    max_consumers_per_subscription?: number;
    backlog_quota_map?: Record<string, {
        limit?: number;
        limitSize?: number;
        limitTime?: number;
        policy?: string;
    }>;
}

/**
 * Topic statistics
 */
export interface TopicStats {
    msgRateIn: number;
    msgRateOut: number;
    msgThroughputIn: number;
    msgThroughputOut: number;
    averageMsgSize: number;
    storageSize: number;
    backlogSize: number;
    publishers: PublisherStats[];
    subscriptions: Record<string, SubscriptionStats>;
    replication: Record<string, ReplicationStats>;
    deduplicationStatus?: string;
}

export interface PublisherStats {
    producerId: number;
    producerName: string;
    address: string;
    connectedSince: string;
    msgRateIn: number;
    msgThroughputIn: number;
    averageMsgSize: number;
}

export interface SubscriptionStats {
    msgRateOut: number;
    msgThroughputOut: number;
    msgRateExpired: number;
    msgBacklog: number;
    msgBacklogNoDelayed: number;
    blockedSubscriptionOnUnackedMsgs: boolean;
    msgDelayed: number;
    unackedMessages: number;
    type: SubscriptionType;
    consumers: ConsumerStats[];
    isDurable: boolean;
    isReplicated: boolean;
}

export interface ConsumerStats {
    consumerName: string;
    address: string;
    connectedSince: string;
    msgRateOut: number;
    msgThroughputOut: number;
    availablePermits: number;
    unackedMessages: number;
    blockedConsumerOnUnackedMsgs: boolean;
}

export interface ReplicationStats {
    msgRateIn: number;
    msgRateOut: number;
    msgThroughputIn: number;
    msgThroughputOut: number;
    replicationBacklog: number;
    connected: boolean;
    replicationDelayInSeconds: number;
}

/**
 * Topic metadata
 */
export interface TopicMetadata {
    partitions: number;
}

/**
 * Partitioned topic metadata
 */
export interface PartitionedTopicMetadata {
    partitions: number;
}

/**
 * Topic internal stats
 */
export interface TopicInternalStats {
    entriesAddedCounter: number;
    numberOfEntries: number;
    totalSize: number;
    currentLedgerEntries: number;
    currentLedgerSize: number;
    lastLedgerCreatedTimestamp: string;
    lastLedgerCreationFailureTimestamp?: string;
    waitingCursorsCount: number;
    pendingAddEntriesCount: number;
    lastConfirmedEntry: string;
    state: string;
    ledgers: LedgerInfo[];
    cursors: Record<string, CursorInfo>;
}

export interface LedgerInfo {
    ledgerId: number;
    entries: number;
    size: number;
    offloaded: boolean;
}

export interface CursorInfo {
    markDeletePosition: string;
    readPosition: string;
    waitingReadOp: boolean;
    pendingReadOps: number;
    messagesConsumedCounter: number;
    cursorLedger: number;
    cursorLedgerLastEntry: number;
    individuallyDeletedMessages: string;
    lastLedgerSwitchTimestamp: string;
    state: string;
}

/**
 * Broker information
 */
export interface BrokerInfo {
    serviceUrl: string;
    webServiceUrl?: string;
    loadReportType?: string;
    cpu?: {
        usage?: number;
        limit?: number;
    };
    memory?: {
        usage?: number;
        limit?: number;
    };
    directMemory?: {
        usage?: number;
        limit?: number;
    };
    bandwidthIn?: {
        usage?: number;
        limit?: number;
    };
    bandwidthOut?: {
        usage?: number;
        limit?: number;
    };
    msgRateIn?: number;
    msgRateOut?: number;
    msgThroughputIn?: number;
    msgThroughputOut?: number;
    bundleCount?: number;
    topics?: number;
}

/**
 * Subscription types supported by Pulsar
 */
export type SubscriptionType = 'Exclusive' | 'Shared' | 'Failover' | 'Key_Shared';

/**
 * Subscription position for reset operations
 */
export interface MessageId {
    ledgerId: number;
    entryId: number;
    partitionIndex?: number;
}

/**
 * Message for producing
 */
export interface PulsarMessage {
    payload: string;
    key?: string;
    properties?: Record<string, string>;
    eventTime?: number;
    replicationClusters?: string[];
}

/**
 * Message received from consumer
 */
export interface ReceivedMessage {
    messageId: string;
    payload: string;
    key?: string;
    properties?: Record<string, string>;
    publishTime: number;
    eventTime?: number;
    redeliveryCount: number;
    topic: string;
}

/**
 * Schema information
 */
export interface SchemaInfo {
    name: string;
    type: string;
    schema: string;
    properties: Record<string, string>;
}

/**
 * Function information (for future use)
 */
export interface FunctionInfo {
    tenant: string;
    namespace: string;
    name: string;
    className: string;
    inputSpecs: Record<string, any>;
    output: string;
    processingGuarantees: string;
    runtime: string;
    parallelism: number;
}
