import { formatWithOptions } from "node:util";
import type { ConsolaReporter, LogObject } from "consola";
import { createConsola } from "consola";

/** Reporter that only shows type prefix for warn/error/fail, not for info/log/success. */
export const reporter: ConsolaReporter = {
  log(logObj: LogObject, ctx) {
    const message = formatWithOptions(
      {},
      ...logObj.args.map((arg) =>
        arg && typeof arg === "object" && "stack" in arg ? (arg as Error).message : arg,
      ),
    );

    const quietTypes = new Set(["info", "log", "success", "start", "ready"]);
    const prefix = quietTypes.has(logObj.type) ? "" : `[${logObj.type}] `;

    const stream =
      logObj.level < 2
        ? ctx.options.stderr || process.stderr
        : ctx.options.stdout || process.stdout;
    stream.write(`${prefix}${message}\n`);
  },
};

export const logger = createConsola({ reporters: [reporter] });
