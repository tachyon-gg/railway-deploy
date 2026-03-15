import { logger } from "../logger.js";

/**
 * Retry wrapper with exponential backoff for Railway API calls.
 */

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10000,
};

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Retry on rate limit, server errors, and network errors
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (/5\d{2}/.test(msg)) return true;
    if (
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("fetch failed") ||
      msg.includes("network")
    )
      return true;
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = {
    ...DEFAULT_OPTIONS,
    ...opts,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5);
      logger.warn(`Retry ${attempt + 1}/${maxRetries} after ${Math.round(jitter)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }
  throw lastError;
}
