import type { GraphQLClient } from "graphql-request";
import {
  GetEgressGatewaysDocument,
  GetEnvironmentConfigDocument,
  GetPrivateNetworkEndpointDocument,
  GetPrivateNetworksDocument,
  GetProjectDocument,
  GetTcpProxiesDocument,
  ListProjectsDocument,
} from "../generated/graphql.js";
import { logger } from "../logger.js";
import type { EnvironmentConfig } from "../types/envconfig.js";

/**
 * Resolve a project name to its ID.
 */
export async function resolveProjectId(
  client: GraphQLClient,
  projectName: string,
): Promise<string> {
  const data = await client.request(ListProjectsDocument);

  const project = data.projects.edges.find((e) => e.node.name === projectName);
  if (!project) {
    const available = data.projects.edges.map((e) => e.node.name).join(", ");
    throw new Error(`Project "${projectName}" not found. Available: ${available}`);
  }
  return project.node.id;
}

/**
 * Resolve an environment name to its ID within a project.
 * If `autoCreate` is true and the environment doesn't exist, it will be created.
 */
export async function resolveEnvironmentId(
  client: GraphQLClient,
  projectId: string,
  environmentName: string,
  autoCreate?: boolean,
): Promise<string> {
  const data = await client.request(GetProjectDocument, { id: projectId });

  const env = data.project.environments.edges.find((e) => e.node.name === environmentName);
  if (env) {
    return env.node.id;
  }

  if (!autoCreate) {
    const available = data.project.environments.edges.map((e) => e.node.name).join(", ");
    throw new Error(
      `Environment "${environmentName}" not found. Available: ${available}\n  Use --apply to create it automatically.`,
    );
  }

  logger.info(`Environment "${environmentName}" not found — creating...`);
  const { createEnvironment } = await import("./mutations.js");
  const created = await createEnvironment(client, projectId, environmentName);
  return created.id;
}

/** Domain info from the GetProject query */
export interface DomainInfo {
  id: string;
  domain: string;
  targetPort?: number;
}

/** Maps returned by fetchServiceMap for building EnvironmentConfig */
export interface ServiceMapResult {
  /** Service name → service ID */
  serviceNameToId: Map<string, string>;
  /** Service ID → service name */
  serviceIdToName: Map<string, string>;
  /** Service name → volume ID (for services that have a volume in this environment) */
  volumeIdByService: Map<string, string>;
  /** Bucket name → bucket ID */
  bucketNameToId: Map<string, string>;
  /** All service names currently in Railway */
  currentServiceNames: Set<string>;
  /** Service name → current service domain info (railway domain) */
  serviceDomainByService: Map<string, DomainInfo>;
  /** Service name → current custom domains */
  customDomainsByService: Map<string, DomainInfo[]>;
}

/**
 * Fetch service name↔ID mappings and volume ID mappings.
 * Uses the slim GetProject query (just names and IDs).
 */
export async function fetchServiceMap(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
): Promise<ServiceMapResult> {
  const data = await client.request(GetProjectDocument, { id: projectId });

  const serviceNameToId = new Map<string, string>();
  const serviceIdToName = new Map<string, string>();
  const currentServiceNames = new Set<string>();

  const serviceDomainByService = new Map<string, DomainInfo>();
  const customDomainsByService = new Map<string, DomainInfo[]>();

  for (const edge of data.project.services.edges) {
    serviceNameToId.set(edge.node.name, edge.node.id);
    serviceIdToName.set(edge.node.id, edge.node.name);
    currentServiceNames.add(edge.node.name);

    // Extract domains for this environment
    const instance = edge.node.serviceInstances.edges.find(
      (si) => si.node.environmentId === environmentId,
    );
    if (instance) {
      const sd = instance.node.domains.serviceDomains[0];
      if (sd) {
        serviceDomainByService.set(edge.node.name, {
          id: sd.id,
          domain: sd.domain,
          ...(sd.targetPort != null ? { targetPort: sd.targetPort } : {}),
        });
      }
      const cds = instance.node.domains.customDomains;
      if (cds.length > 0) {
        customDomainsByService.set(
          edge.node.name,
          cds.map((cd) => ({
            id: cd.id,
            domain: cd.domain,
            ...(cd.targetPort != null ? { targetPort: cd.targetPort } : {}),
          })),
        );
      }
    }
  }

  // Build volume ID lookup: service name → volume ID
  const volumeIdByService = new Map<string, string>();
  for (const volEdge of data.project.volumes.edges) {
    const volume = volEdge.node;
    for (const viEdge of volume.volumeInstances.edges) {
      const vi = viEdge.node;
      if (vi.environmentId === environmentId && vi.serviceId) {
        const serviceName = serviceIdToName.get(vi.serviceId);
        if (serviceName) {
          volumeIdByService.set(serviceName, volume.id);
        }
      }
    }
  }

  // Build bucket name → ID lookup
  const bucketNameToId = new Map<string, string>();
  for (const edge of data.project.buckets.edges) {
    bucketNameToId.set(edge.node.name, edge.node.id);
  }

  return {
    serviceNameToId,
    serviceIdToName,
    volumeIdByService,
    bucketNameToId,
    currentServiceNames,
    serviceDomainByService,
    customDomainsByService,
  };
}

/**
 * Fetch the current EnvironmentConfig from Railway.
 */
/**
 * Check if a service has static outbound IPs (egress gateways) enabled.
 */
export async function hasEgressGateways(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
): Promise<boolean> {
  try {
    const data = await client.request(GetEgressGatewaysDocument, { serviceId, environmentId });
    return data.egressGateways.length > 0;
  } catch {
    return false;
  }
}

export interface TcpProxyInfo {
  id: string;
  applicationPort: number;
}

/**
 * Fetch TCP proxies for a service in an environment.
 * Returns application ports that have TCP proxies configured.
 */
export async function fetchTcpProxies(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
): Promise<number[]> {
  try {
    const data = await client.request(GetTcpProxiesDocument, { serviceId, environmentId });
    return data.tcpProxies.map((p) => p.applicationPort);
  } catch {
    return [];
  }
}

/**
 * Fetch the TCP proxy for a service (with ID for deletion).
 * Returns null if no proxy exists.
 */
export async function fetchTcpProxy(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
): Promise<TcpProxyInfo | null> {
  try {
    const data = await client.request(GetTcpProxiesDocument, { serviceId, environmentId });
    const first = data.tcpProxies[0];
    return first ? { id: first.id, applicationPort: first.applicationPort } : null;
  } catch {
    return null;
  }
}

/** Private network endpoint info */
export interface PrivateEndpointInfo {
  id: string;
  dnsName: string;
  privateNetworkId: string;
}

/**
 * Fetch the private network endpoint for a service.
 * Returns null if the service has no private network endpoint.
 */
export async function fetchPrivateNetworkEndpoint(
  client: GraphQLClient,
  environmentId: string,
  serviceId: string,
): Promise<PrivateEndpointInfo | null> {
  try {
    // First, get the private network for this environment
    const networks = await client.request(GetPrivateNetworksDocument, { environmentId });
    if (networks.privateNetworks.length === 0) return null;
    const networkId = networks.privateNetworks[0].publicId;

    // Then fetch the endpoint for this service
    const data = await client.request(GetPrivateNetworkEndpointDocument, {
      environmentId,
      privateNetworkId: networkId,
      serviceId,
    });
    if (!data.privateNetworkEndpoint) return null;
    return {
      id: data.privateNetworkEndpoint.publicId,
      dnsName: data.privateNetworkEndpoint.dnsName,
      privateNetworkId: networkId,
    };
  } catch {
    return null;
  }
}

export async function fetchEnvironmentConfig(
  client: GraphQLClient,
  environmentId: string,
): Promise<EnvironmentConfig> {
  const data = await client.request(GetEnvironmentConfigDocument, { environmentId });
  if (!data.environment?.config) {
    return {};
  }
  const config = data.environment.config as EnvironmentConfig;
  // Normalize boolean deploy fields that Railway omits when at their default (false).
  // Railway doesn't return sleepApplication: false — it just omits the field.
  // We normalize to explicit false so consumers see a consistent representation.
  if (config.services) {
    for (const svc of Object.values(config.services)) {
      if (svc.deploy && svc.deploy.sleepApplication === undefined) {
        svc.deploy.sleepApplication = false;
      }
    }
  }
  return config;
}
