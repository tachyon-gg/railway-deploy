import type { GraphQLClient } from "graphql-request";
import type { ServiceCreateInput, ServiceInstanceUpdateInput } from "../generated/graphql.js";
import {
  BucketCreateDocument,
  CustomDomainCreateDocument,
  CustomDomainDeleteDocument,
  ServiceCreateDocument,
  ServiceDeleteDocument,
  ServiceInstanceUpdateDocument,
  VariableCollectionUpsertDocument,
  VariableDeleteDocument,
  VolumeCreateDocument,
  VolumeDeleteDocument,
} from "../generated/graphql.js";

export async function createService(
  client: GraphQLClient,
  projectId: string,
  name: string,
  source?: { image?: string; repo?: string },
  environmentId?: string,
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
  skipDeploys?: boolean,
) {
  await client.request(VariableCollectionUpsertDocument, {
    input: {
      projectId,
      environmentId,
      variables,
      ...(skipDeploys !== undefined && {
        skipDeploys: skipDeploys,
      }),
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
) {
  const data = await client.request(CustomDomainCreateDocument, {
    input: { projectId, serviceId, environmentId, domain },
  });
  return data.customDomainCreate;
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
  await client.request(VolumeCreateDocument, {
    input: { projectId, serviceId, environmentId, mountPath },
  });
}

export async function deleteVolume(client: GraphQLClient, volumeId: string) {
  await client.request(VolumeDeleteDocument, { volumeId });
}

export async function createBucket(client: GraphQLClient, projectId: string, name: string) {
  const data = await client.request(BucketCreateDocument, {
    input: { projectId, name },
  });
  return data.bucketCreate;
}
