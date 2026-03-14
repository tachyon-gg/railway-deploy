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
    restartPolicy?: string | null;
    healthcheck?: { path: string; timeout: number } | null;
    cronSchedule?: string | null;
    region?: { region: string; numReplicas: number } | null;
    source?: { image?: string; repo?: string } | null;
    startCommand?: string | null;
    buildCommand?: string | null;
    rootDirectory?: string | null;
    dockerfilePath?: string | null;
    preDeployCommand?: string[] | null;
    restartPolicyMaxRetries?: number | null;
    sleepApplication?: boolean | null;
  };
}

export interface CreateVolume {
  type: "create-volume";
  serviceName: string;
  serviceId: string;
  mount: string;
  name: string;
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
  | CreateVolume
  | DeleteVolume
  | CreateBucket
  | DeleteBucket;

export interface Changeset {
  changes: Change[];
}
