/** Types for diff output — actions to reconcile current state with desired state */

export interface CreateService {
  type: "create-service";
  name: string;
  source?: {
    image?: string;
    repo?: string;
  };
  volume?: {
    mount: string;
    name: string;
  };
  cronSchedule?: string;
}

export interface DeleteService {
  type: "delete-service";
  name: string;
  serviceId: string;
}

export interface UpsertVariables {
  type: "upsert-variables";
  serviceName: string;
  serviceId?: string;
  variables: Record<string, string>;
}

export interface DeleteVariables {
  type: "delete-variables";
  serviceName: string;
  serviceId?: string;
  variableNames: string[];
}

export interface UpsertSharedVariables {
  type: "upsert-shared-variables";
  variables: Record<string, string>;
}

export interface DeleteSharedVariables {
  type: "delete-shared-variables";
  variableNames: string[];
}

export interface CreateDomain {
  type: "create-domain";
  serviceName: string;
  serviceId?: string;
  domain: string;
}

export interface DeleteDomain {
  type: "delete-domain";
  serviceName: string;
  serviceId?: string;
  domain: string;
  domainId: string;
}

export interface UpdateServiceSettings {
  type: "update-service-settings";
  serviceName: string;
  serviceId: string;
  settings: {
    restartPolicy?: string;
    healthcheck?: { path: string; timeout: number };
    cronSchedule?: string;
    regions?: Array<{ region: string; numReplicas: number }>;
    source?: { image?: string; repo?: string };
    startCommand?: string;
    buildCommand?: string;
    rootDirectory?: string;
    dockerfilePath?: string;
    preDeployCommand?: string;
    restartPolicyMaxRetries?: number;
    sleepApplication?: boolean;
  };
}

export interface DeleteVolume {
  type: "delete-volume";
  serviceName: string;
  serviceId: string;
  volumeId: string;
}

export interface CreateBucket {
  type: "create-bucket";
  name: string;
  bucketName: string;
}

export interface DeleteBucket {
  type: "delete-bucket";
  name: string;
  bucketId: string;
}

export type Change =
  | CreateService
  | DeleteService
  | UpsertVariables
  | DeleteVariables
  | UpsertSharedVariables
  | DeleteSharedVariables
  | CreateDomain
  | DeleteDomain
  | UpdateServiceSettings
  | DeleteVolume
  | CreateBucket
  | DeleteBucket;

export interface Changeset {
  changes: Change[];
}
