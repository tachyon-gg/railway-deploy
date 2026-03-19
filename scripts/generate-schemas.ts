#!/usr/bin/env bun
/**
 * Generate JSON schemas from Zod schemas.
 * Run via: bun run scripts/generate-schemas.ts
 * Or as part of: bun run codegen
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod/v4";
import { ProjectConfigSchema, ServiceTemplateSchema } from "../src/config/schema.js";

const SCHEMAS_DIR = join(import.meta.dir, "..", "schemas");

function generate(schema: z.ZodType, filename: string, title: string) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  jsonSchema.title = title;
  const content = `${JSON.stringify(jsonSchema, null, 2)}\n`;
  const path = join(SCHEMAS_DIR, filename);
  writeFileSync(path, content);
  console.log(`  Generated ${path}`);
}

console.log("Generating JSON schemas from Zod...");
generate(ProjectConfigSchema, "project.schema.json", "Railway Deploy Project Config");
generate(ServiceTemplateSchema, "service-template.schema.json", "Railway Deploy Service Template");
console.log("Done.");
