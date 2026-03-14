import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: ["https://backboard.railway.com/graphql/v2"],
  documents: ["src/graphql/**/*.graphql"],
  generates: {
    "src/generated/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: {
        scalars: {
          DateTime: "string",
          JSON: "Record<string, unknown>",
          EnvironmentVariables: "Record<string, string>",
          SubscriptionPlanLimit: "string",
          RailpackInfo: "Record<string, unknown>",
        },
        enumsAsTypes: true,
        skipTypename: true,
        // Removes "Maybe" wrapper for cleaner types
        maybeValue: "T | null | undefined",
      },
    },
  },
};

export default config;
