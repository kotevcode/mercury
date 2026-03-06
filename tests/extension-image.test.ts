import { describe, expect, it } from "bun:test";
import {
  computeImageHash,
  generateDockerfile,
} from "../src/extensions/image-builder.js";
import type { ExtensionMeta } from "../src/extensions/types.js";

function makeMeta(
  name: string,
  cli?: { name: string; install: string },
): ExtensionMeta {
  return {
    name,
    dir: `/fake/${name}`,
    cli,
    hooks: new Map(),
    jobs: new Map(),
    configs: new Map(),
    widgets: [],
  };
}

describe("generateDockerfile", () => {
  it("returns null when no extensions have CLIs", () => {
    const exts = [makeMeta("a"), makeMeta("b")];
    expect(generateDockerfile("base:latest", exts)).toBeNull();
  });

  it("returns null for empty extensions", () => {
    expect(generateDockerfile("base:latest", [])).toBeNull();
  });

  it("generates correct Dockerfile for one CLI extension", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const df = generateDockerfile(
      "ghcr.io/michaelliv/mercury-agent:latest",
      exts,
    );
    expect(df).toBe(
      "FROM ghcr.io/michaelliv/mercury-agent:latest\n# Extension: napkin\nRUN bun add -g napkin-ai",
    );
  });

  it("generates correct Dockerfile for multiple CLI extensions", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
      makeMeta("no-cli"),
      makeMeta("mytool", {
        name: "mytool",
        install: "pip install mytool",
      }),
    ];
    const df = generateDockerfile("base:v1", exts);
    expect(df).toContain("FROM base:v1");
    expect(df).toContain("# Extension: napkin");
    expect(df).toContain("RUN bun add -g napkin-ai");
    expect(df).toContain("# Extension: mytool");
    expect(df).toContain("RUN pip install mytool");
  });
});

describe("computeImageHash", () => {
  it("returns a 12-char hex string", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const hash = computeImageHash("base:latest", exts);
    expect(hash).toHaveLength(12);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const h1 = computeImageHash("base:latest", exts);
    const h2 = computeImageHash("base:latest", exts);
    expect(h1).toBe(h2);
  });

  it("changes when base image changes", () => {
    const exts = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const h1 = computeImageHash("base:v1", exts);
    const h2 = computeImageHash("base:v2", exts);
    expect(h1).not.toBe(h2);
  });

  it("changes when install commands change", () => {
    const e1 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const e2 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai@2.0",
      }),
    ];
    const h1 = computeImageHash("base:latest", e1);
    const h2 = computeImageHash("base:latest", e2);
    expect(h1).not.toBe(h2);
  });

  it("is order-independent (sorted internally)", () => {
    const e1 = [
      makeMeta("a", { name: "a", install: "install-a" }),
      makeMeta("b", { name: "b", install: "install-b" }),
    ];
    const e2 = [
      makeMeta("b", { name: "b", install: "install-b" }),
      makeMeta("a", { name: "a", install: "install-a" }),
    ];
    expect(computeImageHash("base:latest", e1)).toBe(
      computeImageHash("base:latest", e2),
    );
  });

  it("ignores extensions without CLIs", () => {
    const e1 = [
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
    ];
    const e2 = [
      makeMeta("no-cli"),
      makeMeta("napkin", {
        name: "napkin",
        install: "bun add -g napkin-ai",
      }),
      makeMeta("also-no-cli"),
    ];
    expect(computeImageHash("base:latest", e1)).toBe(
      computeImageHash("base:latest", e2),
    );
  });
});
