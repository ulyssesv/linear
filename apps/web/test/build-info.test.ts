import { describe, expect, it } from "vitest";
import { buildInfo, shortCommit } from "../src/server/build-info.ts";
import { buildInfoDefine, resolveBuildInfo } from "../src/server/resolve-build-info.ts";

const head = () => "0123456789abcdef0123456789abcdef01234567";
const noGit = () => undefined;

describe("build info", () => {
  it("SEED-R21 takes version and commit from APP_VERSION and APP_COMMIT", () => {
    expect(resolveBuildInfo({ APP_VERSION: "v1.2.3", APP_COMMIT: "abc1234def" }, head)).toEqual({
      version: "v1.2.3",
      commit: "abc1234def",
    });
  });

  it("SEED-R21 falls back to dev and the git HEAD for local builds", () => {
    expect(resolveBuildInfo({}, head)).toEqual({ version: "dev", commit: head() });
    expect(resolveBuildInfo({ APP_VERSION: "", APP_COMMIT: "" }, head)).toEqual({
      version: "dev",
      commit: head(),
    });
  });

  it("SEED-R21 reports unknown when there is no git HEAD either", () => {
    expect(resolveBuildInfo({}, noGit)).toEqual({ version: "dev", commit: "unknown" });
  });

  it("SEED-R21 reads the real git HEAD by default", () => {
    expect(resolveBuildInfo({}).commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("SEED-R21 exposes the values to the build as compile-time constants", () => {
    expect(buildInfoDefine({ APP_VERSION: "v1.2.3", APP_COMMIT: "abc" })).toEqual({
      __APP_VERSION__: '"v1.2.3"',
      __APP_COMMIT__: '"abc"',
    });
  });

  it("SEED-R21 makes the injected values available at runtime", () => {
    expect(buildInfo.version).toBeTypeOf("string");
    expect(buildInfo.commit).toBeTypeOf("string");
  });

  it("SEED-R21 shortens a commit SHA for display", () => {
    expect(shortCommit(head())).toBe("0123456");
    expect(shortCommit("unknown")).toBe("unknown");
  });
});
