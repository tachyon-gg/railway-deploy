import { GraphQLClient } from "graphql-request";
import { withRetry } from "./retry.js";

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

/**
 * Create a GraphQL client with retry middleware for Railway API calls.
 */
export function createClient(token: string): GraphQLClient {
  const baseClient = new GraphQLClient(RAILWAY_API, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(120_000),
  });

  // Wrap the request method with retry logic
  const originalRequest = baseClient.request.bind(baseClient);
  baseClient.request = ((...args: Parameters<typeof originalRequest>) =>
    withRetry(() => originalRequest(...args))) as typeof originalRequest;

  return baseClient;
}
