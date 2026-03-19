import type { GraphQLClient } from "graphql-request";
import type { ServiceCreateInput } from "../generated/graphql.js";
import {
  BucketCreateDocument,
  CustomDomainCreateDocument,
  CustomDomainDeleteDocument,
  CustomDomainUpdateDocument,
  EgressGatewayAssociationCreateDocument,
  EgressGatewayAssociationsClearDocument,
  EnvironmentCreateDocument,
  EnvironmentDeleteDocument,
  EnvironmentPatchCommitStagedDocument,
  EnvironmentStageChangesDocument,
  PrivateNetworkEndpointDeleteDocument,
  PrivateNetworkEndpointRenameDocument,
  ServiceCreateDocument,
  ServiceDeleteDocument,
  ServiceDomainCreateDocument,
  ServiceDomainDeleteDocument,
  ServiceDomainUpdateDocument,
  TcpProxyDeleteDocument,
  VolumeCreateDocument,
  VolumeDeleteDocument,
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

export async function createBucket(client: GraphQLClient, projectId: string, name: string) {
  const data = await client.request(BucketCreateDocument, {
    input: { projectId, name },
  });
  return data.bucketCreate;
}

export async function deleteVolume(client: GraphQLClient, volumeId: string) {
  await client.request(VolumeDeleteDocument, { volumeId });
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

export async function createCustomDomain(
  client: GraphQLClient,
  projectId: string,
  serviceId: string,
  environmentId: string,
  domain: string,
  targetPort?: number,
) {
  const data = await client.request(CustomDomainCreateDocument, {
    input: {
      projectId,
      serviceId,
      environmentId,
      domain,
      ...(targetPort !== undefined ? { targetPort } : {}),
    },
  });
  return data.customDomainCreate;
}

export async function deleteCustomDomain(client: GraphQLClient, domainId: string) {
  await client.request(CustomDomainDeleteDocument, { id: domainId });
}

export async function updateCustomDomain(
  client: GraphQLClient,
  domainId: string,
  environmentId: string,
  targetPort?: number,
) {
  await client.request(CustomDomainUpdateDocument, {
    id: domainId,
    environmentId,
    ...(targetPort !== undefined ? { targetPort } : {}),
  });
}

export async function createServiceDomain(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
  targetPort?: number,
) {
  const data = await client.request(ServiceDomainCreateDocument, {
    input: {
      serviceId,
      environmentId,
      ...(targetPort !== undefined ? { targetPort } : {}),
    },
  });
  return data.serviceDomainCreate;
}

export async function deleteServiceDomain(client: GraphQLClient, domainId: string) {
  await client.request(ServiceDomainDeleteDocument, { id: domainId });
}

export async function updateServiceDomain(
  client: GraphQLClient,
  input: {
    serviceDomainId: string;
    serviceId: string;
    environmentId: string;
    domain: string;
    targetPort?: number;
  },
) {
  await client.request(ServiceDomainUpdateDocument, { input });
}

export async function renamePrivateNetworkEndpoint(
  client: GraphQLClient,
  endpointId: string,
  dnsName: string,
  privateNetworkId: string,
) {
  await client.request(PrivateNetworkEndpointRenameDocument, {
    id: endpointId,
    dnsName,
    privateNetworkId,
  });
}

export async function deletePrivateNetworkEndpoint(client: GraphQLClient, endpointId: string) {
  await client.request(PrivateNetworkEndpointDeleteDocument, { id: endpointId });
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

export async function deleteTcpProxy(client: GraphQLClient, proxyId: string) {
  await client.request(TcpProxyDeleteDocument, { id: proxyId });
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
