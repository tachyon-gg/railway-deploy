import type { GraphQLClient } from "graphql-request";
import {
  GetEgressGatewaysDocument,
  GetEnvironmentConfigDocument,
  GetProjectDocument,
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

  for (const edge of data.project.services.edges) {
    serviceNameToId.set(edge.node.name, edge.node.id);
    serviceIdToName.set(edge.node.id, edge.node.name);
    currentServiceNames.add(edge.node.name);
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

export async function fetchEnvironmentConfig(
  client: GraphQLClient,
  environmentId: string,
): Promise<EnvironmentConfig> {
  const data = await client.request(GetEnvironmentConfigDocument, { environmentId });
  if (!data.environment?.config) {
    return {};
  }
  return data.environment.config as EnvironmentConfig;
}
