import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logger } from "../src/logger.js";
import { withRetry } from "../src/railway/retry.js";

const fastOpts = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 };

beforeEach(() => {
  logger.mockTypes(() => () => {});
});

afterEach(() => {
  logger.restoreAll();
});

describe("withRetry", () => {
  test("returns result on first success", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), fastOpts);
    expect(result).toBe("ok");
  });

  test("retries on retryable errors and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error("429 Too Many Requests");
      return "done";
    }, fastOpts);
    expect(result).toBe("done");
    expect(calls).toBe(3);
  });

  test("throws immediately on non-retryable errors", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("400 Bad Request");
      }, fastOpts),
    ).rejects.toThrow("400 Bad Request");
    expect(calls).toBe(1);
  });

  test("throws after exhausting all retries", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("502 Bad Gateway");
      }, fastOpts),
    ).rejects.toThrow("502 Bad Gateway");
    // 1 initial + 2 retries = 3
    expect(calls).toBe(3);
  });

  test("respects maxRetries option", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("500 Internal Server Error");
        },
        { maxRetries: 4, baseDelayMs: 1, maxDelayMs: 10 },
      ),
    ).rejects.toThrow("500 Internal Server Error");
    expect(calls).toBe(5);
  });

  test("retries on rate limit (429) errors", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error("429 Too Many Requests");
      return "success";
    }, fastOpts);
    expect(result).toBe("success");
    expect(calls).toBe(2);
  });

  test("retries on rate limit text errors", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error("rate limit exceeded");
      return "success";
    }, fastOpts);
    expect(result).toBe("success");
    expect(calls).toBe(2);
  });

  test("retries on server errors (500, 502, 503)", async () => {
    for (const code of ["500", "502", "503"]) {
      let calls = 0;
      const result = await withRetry(async () => {
        calls++;
        if (calls === 1) throw new Error(`${code} Server Error`);
        return code;
      }, fastOpts);
      expect(result).toBe(code);
      expect(calls).toBe(2);
    }
  });

  test("retries on network errors (econnreset, etimedout, fetch failed)", async () => {
    for (const msg of [
      "ECONNRESET",
      "ETIMEDOUT",
      "fetch failed",
      "ECONNREFUSED",
      "network error",
    ]) {
      let calls = 0;
      const result = await withRetry(async () => {
        calls++;
        if (calls === 1) throw new Error(msg);
        return msg;
      }, fastOpts);
      expect(result).toBe(msg);
      expect(calls).toBe(2);
    }
  });

  test("does not retry on 4xx client errors (400, 401, 403)", async () => {
    for (const msg of ["400 Bad Request", "401 Unauthorized", "403 Forbidden"]) {
      let calls = 0;
      await expect(
        withRetry(async () => {
          calls++;
          throw new Error(msg);
        }, fastOpts),
      ).rejects.toThrow(msg);
      expect(calls).toBe(1);
    }
  });
});
