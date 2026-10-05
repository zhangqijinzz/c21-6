import {
  assessReviewReadiness,
  buildReviewReport,
  renderReviewHtml,
  reviewFileName,
  type ReviewComparisonInput,
} from "../../shared/domain/reviewReport";
import { simulateProject } from "../../shared/domain/simulation";
import type {
  LatencyProject,
  ScenarioSnapshot,
  SimulationMode,
  SimulationResult,
} from "../../shared/domain/types";
import { compareScenarios } from "../scenarios/scenarioViewModel";

export type ReviewExportOutcome =
  { ok: true; fileName: string; html: string } | { ok: false; message: string };

function projectFromSnapshot(scenario: ScenarioSnapshot): LatencyProject {
  return {
    id: scenario.id,
    title: scenario.name,
    nodes: structuredClone(scenario.nodes),
    concurrencyLimit: scenario.concurrencyLimit,
    scenarios: [],
    createdAt: scenario.createdAt,
    updatedAt: scenario.createdAt,
  };
}

function blocked(missing: string[]): ReviewExportOutcome {
  return {
    ok: false,
    message: `暂时无法生成评审材料：${missing.join("；")}`,
  };
}

function buildComparison(
  baseline: ScenarioSnapshot,
  subject: ScenarioSnapshot,
  subjectResult: SimulationResult,
  mode: SimulationMode,
): ReviewComparisonInput {
  const baselineResult = simulateProject(projectFromSnapshot(baseline), mode);
  return {
    baselineLabel: baseline.name,
    subjectLabel: subject.name,
    baselineMs: baselineResult.completionMs,
    subjectMs: subjectResult.completionMs,
    changes: compareScenarios(baseline, subject).changes,
  };
}

export function buildProjectReview(
  project: LatencyProject,
  mode: SimulationMode,
  baselineId?: string,
  generatedAt = Date.now(),
): ReviewExportOutcome {
  const result = simulateProject(project, mode);
  const readiness = assessReviewReadiness(project, result);
  if (!readiness.ready) return blocked(readiness.missing);
  const baseline = project.scenarios.find(
    (scenario) => scenario.id === baselineId,
  );
  const comparison = baseline
    ? buildComparison(
        baseline,
        {
          id: "__current__",
          name: "当前配置",
          createdAt: generatedAt,
          concurrencyLimit: project.concurrencyLimit,
          nodes: project.nodes,
          completionMs: result.completionMs,
          criticalPath: result.criticalPath,
        },
        result,
        mode,
      )
    : undefined;
  const report = buildReviewReport({
    projectTitle: project.title,
    sourceLabel: "当前项目配置",
    nodes: project.nodes,
    concurrencyLimit: project.concurrencyLimit,
    result,
    generatedAt,
    ...(comparison ? { comparison } : {}),
  });
  return {
    ok: true,
    fileName: reviewFileName(project.title, generatedAt),
    html: renderReviewHtml(report),
  };
}

export function buildScenarioReview(
  project: LatencyProject,
  scenarioId: string,
  mode: SimulationMode,
  baselineId?: string,
  generatedAt = Date.now(),
): ReviewExportOutcome {
  const scenario = project.scenarios.find((item) => item.id === scenarioId);
  if (!scenario)
    return blocked(["没有找到选定的方案快照，可能已被删除，请重新选择"]);
  const subjectProject = projectFromSnapshot(scenario);
  const result = simulateProject(subjectProject, mode);
  const readiness = assessReviewReadiness(subjectProject, result);
  if (!readiness.ready) return blocked(readiness.missing);
  const baseline = project.scenarios.find(
    (item) => item.id === baselineId && item.id !== scenario.id,
  );
  const comparison = baseline
    ? buildComparison(baseline, scenario, result, mode)
    : undefined;
  const report = buildReviewReport({
    projectTitle: project.title,
    sourceLabel: `方案快照「${scenario.name}」`,
    nodes: scenario.nodes,
    concurrencyLimit: scenario.concurrencyLimit,
    result,
    generatedAt,
    ...(comparison ? { comparison } : {}),
  });
  return {
    ok: true,
    fileName: reviewFileName(`${project.title}-${scenario.name}`, generatedAt),
    html: renderReviewHtml(report),
  };
}
