import type { GraphQLClient } from "graphql-request";
import type { GetProjectQuery } from "../generated/graphql.js";
import {
  GetEgressGatewaysDocument,
  GetProjectDocument,
  GetServiceInstanceLimitsDocument,
  GetSharedVariablesDocument,
  GetTcpProxiesDocument,
  GetVariablesDocument,
  ListProjectsDocument,
} from "../generated/graphql.js";
import type { BucketState, ServiceState, State } from "../types/state.js";
import { DEFAULT_HEALTHCHECK_TIMEOUT, DEFAULT_NUM_REPLICAS } from "../types/state.js";

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
 */
export async function resolveEnvironmentId(
  client: GraphQLClient,
  projectId: string,
  environmentName: string,
): Promise<string> {
  const data = await client.request(GetProjectDocument, { id: projectId });

  const env = data.project.environments.edges.find((e) => e.node.name === environmentName);
  if (!env) {
    const available = data.project.environments.edges.map((e) => e.node.name).join(", ");
    throw new Error(`Environment "${environmentName}" not found. Available: ${available}`);
  }
  return env.node.id;
}

type ServiceNode = GetProjectQuery["project"]["services"]["edges"][number]["node"];

/**
 * Fetch the live state of a Railway project environment, including all services,
 * variables, domains, volumes, and buckets.
 *
 * Variables are fetched in parallel for all services. If any variable fetch fails,
 * the entire operation aborts to prevent an incomplete state from causing spurious
 * delete-variable changes during diff.
 *
 * @param client - Authenticated GraphQL client.
 * @param projectId - Railway project ID.
 * @param environmentId - Railway environment ID.
 * @returns The current state, plus domain and volume lookup maps keyed by service name.
 * @throws On API errors or partial variable fetch failures.
 */
export async function fetchCurrentState(
  client: GraphQLClient,
  projectId: string,
  environmentId: string,
): Promise<{
  state: State;
  domainMap: Record<string, Array<{ id: string; domain: string; targetPort?: number }>>;
  volumeMap: Record<string, { volumeId: string; mount: string; name: string }>;
  serviceDomainMap: Record<string, { id: string; domain: string }>;
  tcpProxyMap: Record<string, Array<{ id: string; applicationPort: number }>>;
}> {
  const projectData = await client.request(GetProjectDocument, {
    id: projectId,
  });

  // Build volume lookup: serviceId -> volume info (from project.volumes)
  const volumeLookup = new Map<string, { mount: string; name: string; volumeId: string }>();
  for (const volEdge of projectData.project.volumes.edges) {
    const volume = volEdge.node;
    for (const viEdge of volume.volumeInstances.edges) {
      const vi = viEdge.node;
      if (vi.environmentId === environmentId && vi.serviceId) {
        volumeLookup.set(vi.serviceId, {
          mount: vi.mountPath,
          name: volume.name,
          volumeId: volume.id,
        });
      }
    }
  }

  // Build deployment trigger lookup: serviceId -> { triggerId, branch }
  const triggerLookup = new Map<
    string,
    { triggerId: string; branch: string; checkSuites: boolean }
  >();
  const envNode = projectData.project.environments.edges.find((e) => e.node.id === environmentId);
  if (envNode) {
    for (const triggerEdge of envNode.node.deploymentTriggers.edges) {
      const trigger = triggerEdge.node;
      if (trigger.serviceId) {
        triggerLookup.set(trigger.serviceId, {
          triggerId: trigger.id,
          branch: trigger.branch,
          checkSuites: trigger.checkSuites,
        });
      }
    }
  }

  const services: Record<string, ServiceState> = {};
  const domainMap: Record<string, Array<{ id: string; domain: string; targetPort?: number }>> = {};
  const volumeMap: Record<string, { volumeId: string; mount: string; name: string }> = {};
  const serviceDomainMap: Record<string, { id: string; domain: string }> = {};
  const tcpProxyMap: Record<string, Array<{ id: string; applicationPort: number }>> = {};

  // Only process services that have an instance in this environment
  const serviceNodes = projectData.project.services.edges.map((e) => e.node);
  const servicesInEnv = serviceNodes.filter((svc) =>
    svc.serviceInstances.edges.some((e) => e.node.environmentId === environmentId),
  );

  // Fetch variables for all services in parallel, tolerating individual failures
  const variableResults = await Promise.allSettled(
    servicesInEnv.map((svc) =>
      client
        .request(GetVariablesDocument, {
          projectId,
          environmentId,
          serviceId: svc.id,
        })
        .then((data) => ({ serviceId: svc.id, variables: data.variables })),
    ),
  );

  const variableLookup = new Map<string, Record<string, string>>();
  const fetchErrors: string[] = [];
  for (const result of variableResults) {
    if (result.status === "fulfilled") {
      variableLookup.set(result.value.serviceId, result.value.variables);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      fetchErrors.push(reason);
    }
  }
  if (fetchErrors.length > 0) {
    throw new Error(
      `Failed to fetch variables for ${fetchErrors.length} service(s) — aborting to prevent incorrect diff:\n  ${fetchErrors.join("\n  ")}`,
    );
  }

  // Fetch TCP proxies and limits for all services in parallel
  const tcpProxyResults = await Promise.allSettled(
    servicesInEnv.map((svc) =>
      client
        .request(GetTcpProxiesDocument, {
          serviceId: svc.id,
          environmentId,
        })
        .then((data) => ({ serviceId: svc.id, proxies: data.tcpProxies })),
    ),
  );
  const tcpProxyLookup = new Map<string, Array<{ id: string; applicationPort: number }>>();
  for (const result of tcpProxyResults) {
    if (result.status === "fulfilled" && result.value.proxies.length > 0) {
      tcpProxyLookup.set(
        result.value.serviceId,
        result.value.proxies.map((p) => ({ id: p.id, applicationPort: p.applicationPort })),
      );
    }
  }

  const limitsResults = await Promise.allSettled(
    servicesInEnv.map((svc) =>
      client
        .request(GetServiceInstanceLimitsDocument, {
          serviceId: svc.id,
          environmentId,
        })
        .then((data) => ({ serviceId: svc.id, limits: data.serviceInstanceLimits })),
    ),
  );
  const limitsLookup = new Map<string, { memoryGB?: number; vCPUs?: number }>();
  for (const result of limitsResults) {
    if (result.status === "fulfilled" && result.value.limits) {
      const lim = result.value.limits;
      if (lim.memoryGB !== undefined || lim.vCPUs !== undefined) {
        limitsLookup.set(result.value.serviceId, lim);
      }
    }
  }

  // Fetch egress gateways for all services in parallel
  const egressResults = await Promise.allSettled(
    servicesInEnv.map((svc) =>
      client
        .request(GetEgressGatewaysDocument, {
          serviceId: svc.id,
          environmentId,
        })
        .then((data) => ({ serviceId: svc.id, gateways: data.egressGateways })),
    ),
  );
  const egressLookup = new Map<string, boolean>();
  for (const result of egressResults) {
    if (result.status === "fulfilled" && result.value.gateways.length > 0) {
      egressLookup.set(result.value.serviceId, true);
    }
  }

  for (const svc of servicesInEnv) {
    const instanceEdge = svc.serviceInstances.edges.find(
      (e) => e.node.environmentId === environmentId,
    );
    if (!instanceEdge) {
      console.warn(
        `  Warning: Service "${svc.name}" has no instance in this environment — skipping`,
      );
      continue;
    }
    const instance = instanceEdge.node;

    const vol = volumeLookup.get(svc.id);
    services[svc.name] = buildServiceState(
      svc,
      instance,
      variableLookup.get(svc.id) || {},
      vol ? { mount: vol.mount, name: vol.name } : undefined,
    );

    // Populate branch, checkSuites, and deployment trigger info
    const triggerInfo = triggerLookup.get(svc.id);
    if (triggerInfo) {
      services[svc.name].branch = triggerInfo.branch;
      services[svc.name].checkSuites = triggerInfo.checkSuites;
      services[svc.name].deploymentTriggerId = triggerInfo.triggerId;
    }

    if (instance.domains.customDomains.length > 0) {
      domainMap[svc.name] = instance.domains.customDomains.map((d) => ({
        id: d.id,
        domain: d.domain,
        ...(d.targetPort != null ? { targetPort: d.targetPort } : {}),
      }));
    }

    // Extract service domains (Railway-provided .up.railway.app domains)
    if (instance.domains.serviceDomains.length > 0) {
      const sd = instance.domains.serviceDomains[0];
      serviceDomainMap[svc.name] = { id: sd.id, domain: sd.domain };
      // Also populate state with railwayDomain info
      services[svc.name].railwayDomain = {
        ...(sd.targetPort != null ? { targetPort: sd.targetPort } : {}),
      };
    }

    // Populate TCP proxies
    const proxies = tcpProxyLookup.get(svc.id);
    if (proxies && proxies.length > 0) {
      tcpProxyMap[svc.name] = proxies;
      services[svc.name].tcpProxies = proxies.map((p) => p.applicationPort);
    }

    // Populate limits
    const lim = limitsLookup.get(svc.id);
    if (lim) {
      services[svc.name].limits = lim;
    }

    // Populate static outbound IPs
    if (egressLookup.get(svc.id)) {
      services[svc.name].staticOutboundIps = true;
    }

    if (vol) {
      volumeMap[svc.name] = vol;
    }
  }

  // Fetch shared (environment-level) variables
  const sharedData = await client.request(GetSharedVariablesDocument, {
    projectId,
    environmentId,
  });

  // Extract buckets
  const buckets: Record<string, BucketState> = {};
  for (const edge of projectData.project.buckets.edges) {
    const bucket = edge.node;
    // Use bucket name as key (user-facing identifier)
    buckets[bucket.name] = {
      id: bucket.id,
      name: bucket.name,
    };
  }

  return {
    state: {
      projectId,
      environmentId,
      sharedVariables: sharedData.variables,
      services,
      buckets,
    },
    domainMap,
    volumeMap,
    serviceDomainMap,
    tcpProxyMap,
  };
}

type InstanceNode = ServiceNode["serviceInstances"]["edges"][number]["node"];

function buildServiceState(
  svc: ServiceNode,
  instance: InstanceNode,
  variables: Record<string, string>,
  volume?: { mount: string; name: string },
): ServiceState {
  const state: ServiceState = {
    name: svc.name,
    id: svc.id,
    variables,
    domains: [],
  };

  if (instance.source?.image) {
    state.source = { image: instance.source.image };
  }
  if (instance.source?.repo) {
    state.source = { ...state.source, repo: instance.source.repo };
  }
  if (instance.region) {
    state.region = {
      region: instance.region,
      numReplicas: instance.numReplicas ?? DEFAULT_NUM_REPLICAS,
    };
  }
  if (instance.restartPolicyType) {
    state.restartPolicy = instance.restartPolicyType;
  }
  if (instance.healthcheckPath) {
    state.healthcheck = {
      path: instance.healthcheckPath,
      timeout: instance.healthcheckTimeout ?? DEFAULT_HEALTHCHECK_TIMEOUT,
    };
  }
  if (instance.cronSchedule) {
    state.cronSchedule = instance.cronSchedule;
  }
  if (instance.startCommand) {
    state.startCommand = instance.startCommand;
  }
  if (instance.buildCommand) {
    state.buildCommand = instance.buildCommand;
  }
  if (instance.rootDirectory) {
    state.rootDirectory = instance.rootDirectory;
  }
  if (instance.dockerfilePath) {
    state.dockerfilePath = instance.dockerfilePath;
  }
  if (instance.preDeployCommand) {
    // Railway returns preDeployCommand as JSON (string or string[])
    const pdc = instance.preDeployCommand;
    if (typeof pdc === "string") {
      state.preDeployCommand = [pdc];
    } else if (Array.isArray(pdc) && pdc.length > 0) {
      state.preDeployCommand = pdc;
    }
  }
  if (instance.restartPolicyMaxRetries !== undefined && instance.restartPolicyMaxRetries !== null) {
    state.restartPolicyMaxRetries = instance.restartPolicyMaxRetries;
  }
  if (instance.sleepApplication !== undefined && instance.sleepApplication !== null) {
    state.sleepApplication = instance.sleepApplication;
  }
  // Group 1 fields
  state.builder = instance.builder;
  state.watchPatterns = instance.watchPatterns;
  if (instance.drainingSeconds !== undefined && instance.drainingSeconds !== null) {
    state.drainingSeconds = instance.drainingSeconds;
  }
  if (instance.overlapSeconds !== undefined && instance.overlapSeconds !== null) {
    state.overlapSeconds = instance.overlapSeconds;
  }
  if (instance.ipv6EgressEnabled !== undefined && instance.ipv6EgressEnabled !== null) {
    state.ipv6EgressEnabled = instance.ipv6EgressEnabled;
  }
  if (instance.railwayConfigFile) {
    state.railwayConfigFile = instance.railwayConfigFile;
  }
  if (volume) {
    state.volume = volume;
  }
  if (instance.domains.customDomains.length > 0) {
    state.domains = instance.domains.customDomains.map((d) => ({
      domain: d.domain,
      ...(d.targetPort != null ? { targetPort: d.targetPort } : {}),
    }));
  }

  return state;
}
