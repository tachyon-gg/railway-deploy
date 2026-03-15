/** Unified state type — shared by config loader and Railway query output */

/** Default healthcheck timeout in seconds */
export const DEFAULT_HEALTHCHECK_TIMEOUT = 300;

/** Default number of replicas */
export const DEFAULT_NUM_REPLICAS = 1;

export interface ServiceState {
  name: string;
  source?: {
    image?: string;
    repo?: string;
  };
  variables: Record<string, string>;
  domains: Array<{ domain: string; targetPort?: number }>;
  volume?: {
    mount: string;
    name: string;
  };
  region?: {
    region: string;
    numReplicas: number;
  };
  restartPolicy?: string;
  healthcheck?: {
    path: string;
    timeout: number;
  };
  cronSchedule?: string;
  startCommand?: string;
  buildCommand?: string;
  rootDirectory?: string;
  dockerfilePath?: string;
  preDeployCommand?: string[];
  restartPolicyMaxRetries?: number;
  sleepApplication?: boolean;
  builder?: string;
  watchPatterns?: string[];
  drainingSeconds?: number;
  overlapSeconds?: number;
  ipv6EgressEnabled?: boolean;
  branch?: string;
  checkSuites?: boolean;
  deploymentTriggerId?: string;
  registryCredentials?: { username: string; password: string };
  /** Railway-provided domain configuration */
  railwayDomain?: { targetPort?: number };
  /** TCP proxy application ports */
  tcpProxies?: number[];
  /** Resource limits */
  limits?: { memoryGB?: number; vCPUs?: number };
  /** Railway config file path */
  railwayConfigFile?: string;
  /** Static outbound IPs enabled */
  staticOutboundIps?: boolean;
  /** Railway Metal (VM runtime) enabled */
  metal?: boolean;
  /** Railway service ID — present only in current state from Railway */
  id?: string;
}

export interface BucketState {
  id: string;
  name: string;
}

export interface State {
  projectId: string;
  environmentId: string;
  sharedVariables: Record<string, string>;
  services: Record<string, ServiceState>;
  buckets: Record<string, BucketState>;
}
