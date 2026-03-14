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
  domains: string[];
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
