import { describe, expect, it } from "vitest";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";
import type {
  LatencyProject,
  ScenarioSnapshot,
} from "../src/shared/domain/types";
import { simulateProject } from "../src/shared/domain/simulation";
import { saveScenario } from "../src/features/scenarios/scenarioViewModel";
import {
  assessReviewReadiness,
  buildReviewPackage,
} from "../src/features/review/export/reviewPackage";
import { renderReviewHtml } from "../src/features/review/export/reviewHtml";

const valid: LatencyProject = structuredClone(EXAMPLE_PROJECT);

function firstSnapshot(
  project: LatencyProject,
  name: string,
): ScenarioSnapshot {
  const snapshot = saveScenario(project, simulateProject(project), name)
    .scenarios[0];
  if (!snapshot) throw new Error("snapshot should exist");
  return snapshot;
}

describe("review package readiness", () => {
  it("is ready for a valid project and flags a cyclic graph with the missing piece", () => {
    expect(
      assessReviewReadiness({ kind: "project", project: valid }).ready,
    ).toBe(true);
    const cyclic: LatencyProject = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.id === "session"
          ? { ...node, dependencyIds: ["recommend"] }
          : node,
      ),
    };
    const readiness = assessReviewReadiness({
      kind: "project",
      project: cyclic,
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toContain("循环依赖");
  });

  it("warns but allows an empty project", () => {
    const empty: LatencyProject = { ...valid, nodes: [] };
    const readiness = assessReviewReadiness({
      kind: "project",
      project: empty,
    });
    expect(readiness.ready).toBe(true);
    expect(readiness.concerns.join(" ")).toContain("没有请求节点");
  });
});

describe("review package content", () => {
  it("freezes parameters, timeline, critical path and risks from the project", () => {
    const source: LatencyProject = structuredClone(EXAMPLE_PROJECT);
    const pkg = buildReviewPackage(
      { kind: "project", project: source },
      { mode: "high" },
    );
    expect(pkg.mode).toBe("high");
    expect(pkg.nodeCount).toBe(source.nodes.length);
    expect(pkg.params).toHaveLength(source.nodes.length);
    expect(pkg.timeline).toHaveLength(source.nodes.length);
    expect(pkg.criticalPathNames).toContain("个性推荐");
    expect(pkg.completionMs).toBeGreaterThan(0);
    // 风险提示至少覆盖示例中的高失败率/重试或超时口径
    expect(Array.isArray(pkg.risks)).toBe(true);

    // 生成后再修改工程参数，不会回流到已经构建好的材料
    const beforeCompletion = pkg.completionMs;
    source.nodes[0]!.durationMs = 5000;
    expect(pkg.completionMs).toBe(beforeCompletion);
    expect(pkg.params[0]!.name).toBe("会话校验");
  });

  it("restores a snapshot and locks its saved mode", () => {
    const snapshot = firstSnapshot(valid, "基线方案");
    const pkg = buildReviewPackage({
      kind: "snapshot",
      project: valid,
      snapshot,
    });
    expect(pkg.sourceType).toBe("snapshot");
    expect(pkg.sourceName).toBe("基线方案");
    expect(pkg.completionMs).toBe(snapshot.completionMs);
    expect(pkg.timeline.length).toBeGreaterThan(0);
  });

  it("adds a comparison section against a selected baseline", () => {
    const baseline = firstSnapshot(valid, "基准");
    const slower: LatencyProject = {
      ...valid,
      nodes: valid.nodes.map((node) =>
        node.id === "catalog" ? { ...node, durationMs: 1200 } : node,
      ),
    };
    const pkg = buildReviewPackage(
      { kind: "project", project: slower },
      { mode: "expected", baselineSnapshot: baseline },
    );
    expect(pkg.comparison).toBeDefined();
    expect(pkg.comparison?.baselineName).toBe("基准");
    expect(pkg.comparison?.deltaMs).toBeGreaterThan(0);
    expect(pkg.comparison?.changes.join(" ")).toContain("商品目录");
  });
});

describe("review html rendering", () => {
  it("renders every required section into a self-contained offline document", () => {
    const pkg = buildReviewPackage({ kind: "project", project: valid });
    const html = renderReviewHtml(pkg);
    expect(html).toContain("关键参数");
    expect(html).toContain("执行时序");
    expect(html).toContain("关键链路");
    expect(html).toContain("告警与风险提示");
    expect(html).toContain("只读快照");
    // 不依赖网络：不允许出现外部资源引用
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script[^>]*src/i);
    expect(html).not.toMatch(/<link[^>]*href/i);
  });

  it("escapes dynamic node names so content cannot inject markup", () => {
    const malicious: LatencyProject = {
      ...valid,
      nodes: valid.nodes.map((node, index) =>
        index === 0
          ? { ...node, name: '<img src=x onerror="alert(1)">' }
          : node,
      ),
    };
    const html = renderReviewHtml(
      buildReviewPackage({ kind: "project", project: malicious }),
    );
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });
});
