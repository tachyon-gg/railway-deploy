import type { GraphQLClient } from "graphql-request";
import type {
  DeploymentTriggerUpdateInput,
  ServiceCreateInput,
  ServiceInstanceUpdateInput,
} from "../generated/graphql.js";
import {
  BucketCreateDocument,
  CustomDomainCreateDocument,
  CustomDomainDeleteDocument,
  CustomDomainUpdateDocument,
  DeploymentTriggerUpdateDocument,
  EgressGatewayAssociationCreateDocument,
  EgressGatewayAssociationsClearDocument,
  EnvironmentCreateDocument,
  ServiceCreateDocument,
  ServiceDeleteDocument,
  ServiceDomainCreateDocument,
  ServiceDomainDeleteDocument,
  ServiceDomainUpdateDocument,
  ServiceInstanceLimitsUpdateDocument,
  ServiceInstanceUpdateDocument,
  TcpProxyCreateDocument,
  TcpProxyDeleteDocument,
  VariableCollectionUpsertDocument,
  VariableDeleteDocument,
  VolumeCreateDocument,
  VolumeDeleteDocument,
  VolumeInstanceUpdateDocument,
  VolumeUpdateDocument,
} from "../generated/graphql.js";

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

export async function upsertVariables(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
  serviceId: string,
  variables: Record<string, string>,
  skipDeploys?: boolean,
) {
  await client.request(VariableCollectionUpsertDocument, {
    input: {
      projectId,
      environmentId,
      serviceId,
      variables,
      ...(skipDeploys !== undefined && {
        skipDeploys: skipDeploys,
      }),
    },
  });
}

export async function upsertSharedVariables(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
  variables: Record<string, string>,
) {
  await client.request(VariableCollectionUpsertDocument, {
    input: {
      projectId,
      environmentId,
      variables,
    },
  });
}

export async function deleteVariable(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
  serviceId: string,
  name: string,
) {
  await client.request(VariableDeleteDocument, {
    input: { projectId, environmentId, serviceId, name },
  });
}

export async function deleteSharedVariable(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
  name: string,
) {
  await client.request(VariableDeleteDocument, {
    input: { projectId, environmentId, name },
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

export async function deleteCustomDomain(client: GraphQLClient, domainId: string) {
  await client.request(CustomDomainDeleteDocument, { id: domainId });
}

export async function updateServiceInstance(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
  input: ServiceInstanceUpdateInput,
) {
  await client.request(ServiceInstanceUpdateDocument, {
    serviceId,
    environmentId,
    input,
  });
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

export async function updateVolumeInstance(
  client: GraphQLClient,
  volumeId: string,
  environmentId: string,
  mountPath: string,
) {
  await client.request(VolumeInstanceUpdateDocument, {
    volumeId,
    environmentId,
    input: { mountPath },
  });
}

export async function deleteVolume(client: GraphQLClient, volumeId: string) {
  await client.request(VolumeDeleteDocument, { volumeId });
}

export async function updateDeploymentTrigger(
  client: GraphQLClient,
  triggerId: string,
  input: DeploymentTriggerUpdateInput,
) {
  const data = await client.request(DeploymentTriggerUpdateDocument, {
    id: triggerId,
    input,
  });
  return data.deploymentTriggerUpdate;
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

export async function deleteServiceDomain(client: GraphQLClient, domainId: string) {
  await client.request(ServiceDomainDeleteDocument, { id: domainId });
}

export async function createTcpProxy(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
  applicationPort: number,
) {
  const data = await client.request(TcpProxyCreateDocument, {
    input: { serviceId, environmentId, applicationPort },
  });
  return data.tcpProxyCreate;
}

export async function deleteTcpProxy(client: GraphQLClient, proxyId: string) {
  await client.request(TcpProxyDeleteDocument, { id: proxyId });
}

export async function updateServiceInstanceLimits(
  client: GraphQLClient,
  serviceId: string,
  environmentId: string,
  limits: { memoryGB?: number | null; vCPUs?: number | null },
) {
  await client.request(ServiceInstanceLimitsUpdateDocument, {
    input: {
      serviceId,
      environmentId,
      ...(limits.memoryGB !== undefined ? { memoryGB: limits.memoryGB } : {}),
      ...(limits.vCPUs !== undefined ? { vCPUs: limits.vCPUs } : {}),
    },
  });
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

export async function createBucket(client: GraphQLClient, projectId: string, name: string) {
  const data = await client.request(BucketCreateDocument, {
    input: { projectId, name },
  });
  return data.bucketCreate;
}

export async function createEnvironment(client: GraphQLClient, projectId: string, name: string) {
  const data = await client.request(EnvironmentCreateDocument, {
    input: { projectId, name },
  });
  return data.environmentCreate;
}
