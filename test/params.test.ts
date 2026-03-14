import { describe, expect, test } from "bun:test";
import { expandParams, expandParamsDeep, resolveParams } from "../src/config/params.js";

describe("resolveParams", () => {
  test("passes through provided values", () => {
    const defs = { env: { required: true } };
    const result = resolveParams(defs, { env: "alpha" });
    expect(result).toEqual({ env: "alpha" });
  });

  test("applies defaults for missing params", () => {
    const defs = { ratio: { default: "1.0" } };
    const result = resolveParams(defs, {});
    expect(result).toEqual({ ratio: "1.0" });
  });

  test("provided values override defaults", () => {
    const defs = { ratio: { default: "1.0" } };
    const result = resolveParams(defs, { ratio: "0.5" });
    expect(result).toEqual({ ratio: "0.5" });
  });

  test("throws on missing required param", () => {
    const defs = { env: { required: true } };
    expect(() => resolveParams(defs, {})).toThrow("Missing required parameter: env");
  });

  test("warns on unknown params but still works", () => {
    const defs = { env: { required: true } };
    const result = resolveParams(defs, { env: "alpha", extra: "val" });
    expect(result).toEqual({ env: "alpha" });
  });
});

describe("expandParams", () => {
  test("expands %{param} placeholders", () => {
    const result = expandParams("ghcr.io/org/repo:%{env}", { env: "alpha" });
    expect(result).toBe("ghcr.io/org/repo:alpha");
  });

  test("expands multiple placeholders", () => {
    const result = expandParams("%{a}-%{b}", { a: "x", b: "y" });
    expect(result).toBe("x-y");
  });

  test("throws on unresolved param", () => {
    expect(() => expandParams("%{missing}", {})).toThrow("Unresolved parameter: %{missing}");
  });

  test("leaves non-param text untouched", () => {
    const result = expandParams("no params here", {});
    expect(result).toBe("no params here");
  });

  test("does not expand ${} or ${{}} syntax", () => {
    const result = expandParams("${FOO} ${{svc.VAR}}", {});
    expect(result).toBe("${FOO} ${{svc.VAR}}");
  });
});

describe("expandParamsDeep", () => {
  test("expands in nested objects", () => {
    const input = { source: { image: "repo:%{tag}" }, name: "%{name}" };
    const result = expandParamsDeep(input, { tag: "v1", name: "svc" });
    expect(result).toEqual({ source: { image: "repo:v1" }, name: "svc" });
  });

  test("expands in arrays", () => {
    const input = ["%{a}", "%{b}"];
    const result = expandParamsDeep(input, { a: "1", b: "2" });
    expect(result).toEqual(["1", "2"]);
  });

  test("passes through non-string primitives", () => {
    const input = { num: 42, bool: true, nil: null };
    const result = expandParamsDeep(input, {});
    expect(result).toEqual({ num: 42, bool: true, nil: null });
  });
});
