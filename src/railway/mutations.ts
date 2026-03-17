import type { GraphQLClient } from "graphql-request";
import type { ServiceCreateInput } from "../generated/graphql.js";
import {
  EgressGatewayAssociationCreateDocument,
  EgressGatewayAssociationsClearDocument,
  EnvironmentCreateDocument,
  EnvironmentDeleteDocument,
  EnvironmentPatchCommitStagedDocument,
  EnvironmentStageChangesDocument,
  ServiceCreateDocument,
  ServiceDeleteDocument,
  VolumeCreateDocument,
  VolumeUpdateDocument,
} from "../generated/graphql.js";
import type { EnvironmentConfig } from "../types/envconfig.js";

export async function createService(
  client: GraphQLClient,
  projectId: string,
  name: string,
  source?: { image?: string; repo?: string },
  environmentId?: string,
  branch?: string,
  registryCredentials?: { username: string; password: string },
) {
  const input: ServiceCreateInput = { projectId, name };
  if (source) {
    input.source = {};
    if (source.image) input.source.image = source.image;
    if (source.repo) input.source.repo = source.repo;
  }
  if (environmentId) {
    input.environmentId = environmentId;
  }
  if (branch) {
    input.branch = branch;
  }
  if (registryCredentials) {
    input.registryCredentials = registryCredentials;
  }

  const data = await client.request(ServiceCreateDocument, { input });
  return data.serviceCreate;
}

export async function deleteService(client: GraphQLClient, serviceId: string) {
  await client.request(ServiceDeleteDocument, { id: serviceId });
}

export async function createVolume(
  client: GraphQLClient,
  projectId: string,
  serviceId: string,
  environmentId: string,
  mountPath: string,
) {
  const data = await client.request(VolumeCreateDocument, {
    input: { projectId, serviceId, environmentId, mountPath },
  });
  return data.volumeCreate;
}

export async function updateVolume(client: GraphQLClient, volumeId: string, name: string) {
  await client.request(VolumeUpdateDocument, { volumeId, input: { name } });
}

export async function createEgressGateway(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
) {
  const data = await client.request(EgressGatewayAssociationCreateDocument, {
    input: { serviceId, environmentId },
  });
  return data.egressGatewayAssociationCreate;
}

export async function clearEgressGateways(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
) {
  await client.request(EgressGatewayAssociationsClearDocument, {
    input: { serviceId, environmentId },
  });
}

export async function deleteEnvironment(client: GraphQLClient, environmentId: string) {
  await client.request(EnvironmentDeleteDocument, { id: environmentId });
}

export async function createEnvironment(client: GraphQLClient, projectId: string, name: string) {
  const data = await client.request(EnvironmentCreateDocument, {
    input: { projectId, name },
  });
  return data.environmentCreate;
}

/**
 * Stage environment changes. Uses merge mode to add/update without full replacement.
 */
export async function stageEnvironmentChanges(
  client: GraphQLClient,
  environmentId: string,
  config: EnvironmentConfig,
  merge?: boolean,
) {
  const data = await client.request(EnvironmentStageChangesDocument, {
    environmentId,
    input: config as Record<string, unknown>,
    merge: merge ?? true,
  });
  return data.environmentStageChanges;
}

/**
 * Commit staged changes. This atomically applies the staged patch and triggers deploys.
 */
export async function commitStagedChanges(
  client: GraphQLClient,
  environmentId: string,
  commitMessage?: string,
  skipDeploys?: boolean,
) {
  const data = await client.request(EnvironmentPatchCommitStagedDocument, {
    environmentId,
    ...(commitMessage ? { commitMessage } : {}),
    ...(skipDeploys !== undefined ? { skipDeploys } : {}),
  });
  return data.environmentPatchCommitStaged;
}
