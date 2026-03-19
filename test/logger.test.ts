import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createConsola } from "consola";
import { logger, reporter } from "../src/logger.js";

/** Create a writable stream that captures output into an array. */
function captureStream(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

describe("logger reporter", () => {
  test("info/success/log have no type prefix", () => {
    const { stream: stdout, lines } = captureStream();
    const log = createConsola({ reporters: [reporter], stdout, stderr: stdout, level: 5 });

    log.info("info msg");
    log.success("success msg");
    log.log("log msg");

    expect(lines.some((l) => l.includes("info msg") && !l.includes("[info]"))).toBe(true);
    expect(lines.some((l) => l.includes("success msg") && !l.includes("[success]"))).toBe(true);
    expect(lines.some((l) => l.includes("log msg") && !l.includes("[log]"))).toBe(true);
  });

  test("warn/error have type prefix", () => {
    const { stream: stderr, lines } = captureStream();
    const log = createConsola({ reporters: [reporter], stdout: stderr, stderr, level: 5 });

    log.warn("caution");
    log.error("failure");

    expect(lines.some((l) => l === "[warn] caution\n")).toBe(true);
    expect(lines.some((l) => l === "[error] failure\n")).toBe(true);
  });

  test("Error objects are formatted as message strings", () => {
    const { stream: stderr, lines } = captureStream();
    const log = createConsola({ reporters: [reporter], stdout: stderr, stderr, level: 5 });

    log.error(new Error("something broke"));

    expect(lines.some((l) => l.includes("something broke"))).toBe(true);
  });
});

describe("logger mock", () => {
  test("mockTypes captures output", () => {
    const captured: Array<{ type: string; message: string }> = [];
    logger.mockTypes((type) => (...args: unknown[]) => {
      captured.push({ type, message: args.map(String).join(" ") });
    });

    logger.info("info msg");
    logger.warn("warn msg");

    logger.restoreAll();

    expect(captured).toContainEqual({ type: "info", message: "info msg" });
    expect(captured).toContainEqual({ type: "warn", message: "warn msg" });
  });
});
