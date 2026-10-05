import { describe, expect, it } from "vitest";
import {
  assessReviewReadiness,
  buildReviewReport,
  renderReviewHtml,
  reviewFileName,
} from "../src/shared/domain/reviewReport";
import { simulateProject } from "../src/shared/domain/simulation";
import { EXAMPLE_PROJECT } from "../src/shared/domain/types";
import {
  buildProjectReview,
  buildScenarioReview,
} from "../src/features/review/reviewViewModel";
import { saveScenario } from "../src/features/scenarios/scenarioViewModel";

const GENERATED_AT = new Date(2026, 9, 5, 14, 30).getTime();

describe("review readiness", () => {
  it("blocks export when the graph is empty, cyclic, or invalid", () => {
    const empty = { ...EXAMPLE_PROJECT, nodes: [] };
    const emptyCheck = assessReviewReadiness(empty, simulateProject(empty));
    expect(emptyCheck.ready).toBe(false);
    expect(emptyCheck.missing.join(" ")).toContain("请求节点");

    const cyclic = {
      ...EXAMPLE_PROJECT,
      nodes: EXAMPLE_PROJECT.nodes.map((node) =>
        node.id === "session" ? { ...node, dependencyIds: ["profile"] } : node,
      ),
    };
    const cyclicCheck = assessReviewReadiness(cyclic, simulateProject(cyclic));
    expect(cyclicCheck.ready).toBe(false);
    expect(cyclicCheck.missing.join(" ")).toContain("循环依赖");
    expect(cyclicCheck.missing.join(" ")).toContain("推演结果不完整");

    const outcome = buildProjectReview(cyclic, "expected");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("循环依赖");
  });

  it("passes when every node has a timeline entry", () => {
    const result = simulateProject(EXAMPLE_PROJECT);
    const readiness = assessReviewReadiness(EXAMPLE_PROJECT, result);
    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
  });
});

describe("offline review document", () => {
  it("contains parameters, timeline, critical path, and risk warnings", () => {
    const outcome = buildProjectReview(
      EXAMPLE_PROJECT,
      "expected",
      undefined,
      GENERATED_AT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const html = outcome.html;
    expect(html).toContain(EXAMPLE_PROJECT.title);
    expect(html).toContain("当前项目配置");
    expect(html).toContain("2026-10-05 14:30");
    for (const node of EXAMPLE_PROJECT.nodes) expect(html).toContain(node.name);
    expect(html).toContain("关键链路");
    expect(html).toContain("执行时序");
    expect(html).toContain("告警与风险提示");
    expect(html).toContain("降级");
    expect(html).toContain("生成那一刻的只读快照");
    expect(outcome.fileName).toBe(
      "评审材料-商品详情页-·-首屏预算-20261005-1430.html",
    );
  });

  it("is fully self-contained and escapes user input", () => {
    const hostile = {
      ...EXAMPLE_PROJECT,
      title: "链路<img src=x onerror=alert(1)>",
      nodes: EXAMPLE_PROJECT.nodes.map((node, index) =>
        index === 0 ? { ...node, name: '<script>alert("x")</script>' } : node,
      ),
    };
    const outcome = buildProjectReview(
      hostile,
      "high",
      undefined,
      GENERATED_AT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.html).not.toContain("<script>alert");
    expect(outcome.html).not.toContain("<img src=x");
    expect(outcome.html).toContain("&lt;script&gt;");
    // 除内联 <style> 外没有任何外部资源引用
    expect(outcome.html).not.toMatch(/<(script|link|img|iframe)[\s>]/);
    expect(outcome.html).not.toContain("http://");
    expect(outcome.html).not.toContain("https://");
    expect(outcome.html).toContain("<style>");
  });

  it("freezes content at generation time and is unaffected by later edits", () => {
    const first = buildProjectReview(
      EXAMPLE_PROJECT,
      "expected",
      undefined,
      GENERATED_AT,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const changed = {
      ...EXAMPLE_PROJECT,
      title: "已改名的链路",
      nodes: EXAMPLE_PROJECT.nodes.map((node) => ({
        ...node,
        durationMs: node.durationMs + 5000,
      })),
    };
    const second = buildProjectReview(
      changed,
      "expected",
      undefined,
      GENERATED_AT,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(first.html).toContain("商品详情页 · 首屏预算");
    expect(first.html).not.toContain("已改名的链路");
    expect(second.html).not.toBe(first.html);
  });

  it("includes a difference section when a baseline scenario is selected", () => {
    const baseline = saveScenario(
      EXAMPLE_PROJECT,
      simulateProject(EXAMPLE_PROJECT),
      "基线方案",
    ).scenarios[0];
    if (!baseline) throw new Error("baseline snapshot should exist");
    const project = {
      ...EXAMPLE_PROJECT,
      concurrencyLimit: 1,
      scenarios: [baseline],
    };
    const outcome = buildProjectReview(
      project,
      "expected",
      baseline.id,
      GENERATED_AT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.html).toContain("方案差异");
    expect(outcome.html).toContain("基线方案");
    expect(outcome.html).toContain("当前配置");
    expect(outcome.html).toContain("并发上限");
  });

  it("exports a saved snapshot with deterministic recomputed timing", () => {
    const withScenario = saveScenario(
      EXAMPLE_PROJECT,
      simulateProject(EXAMPLE_PROJECT),
      "并发优化",
    );
    const scenario = withScenario.scenarios[0];
    if (!scenario) throw new Error("scenario snapshot should exist");
    const outcome = buildScenarioReview(
      withScenario,
      scenario.id,
      "expected",
      undefined,
      GENERATED_AT,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.html).toContain("方案快照「并发优化」");
    expect(outcome.html).not.toContain("方案差异");
    const report = buildReviewReport({
      projectTitle: withScenario.title,
      sourceLabel: "方案快照「并发优化」",
      nodes: scenario.nodes,
      concurrencyLimit: scenario.concurrencyLimit,
      result: simulateProject(EXAMPLE_PROJECT, "expected"),
      generatedAt: GENERATED_AT,
    });
    expect(report.completionMs).toBe(scenario.completionMs);
    expect(outcome.html).toBe(renderReviewHtml(report));
  });

  it("reports a missing snapshot instead of generating an empty file", () => {
    const outcome = buildScenarioReview(
      EXAMPLE_PROJECT,
      "scenario-not-exist",
      "expected",
      undefined,
      GENERATED_AT,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("方案快照");
  });

  it("formats a safe offline file name", () => {
    expect(reviewFileName('a/b\\c:d*e?f"g<h>i|j 链路', GENERATED_AT)).toBe(
      "评审材料-a-b-c-d-e-f-g-h-i-j-链路-20261005-1430.html",
    );
    expect(reviewFileName("   ", GENERATED_AT)).toBe(
      "评审材料-链路-20261005-1430.html",
    );
  });
});
