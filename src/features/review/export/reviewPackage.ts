import { analyzeGraph } from "../../../shared/domain/graph";
import { simulateProject } from "../../../shared/domain/simulation";
import { compareScenarios } from "../../scenarios/scenarioViewModel";
import type {
  LatencyProject,
  RequestNode,
  ScenarioSnapshot,
  SimulationMode,
  SimulationResult,
  TimelineEntry,
} from "../../../shared/domain/types";

/** 评审材料的来源：当前项目实时参数，或某份已保存的方案快照。 */
export type ReviewSource =
  | { kind: "project"; project: LatencyProject }
  | { kind: "snapshot"; project: LatencyProject; snapshot: ScenarioSnapshot };

export interface ReviewNodeParam {
  id: string;
  name: string;
  durationMs: number;
  jitterMs: number;
  timeoutMs: number;
  retryCount: number;
  failureRate: number;
  fallbackName?: string;
  dependencyNames: string[];
}

export interface ReviewTimelineRow {
  name: string;
  startMs: number;
  endMs: number;
  modeledDurationMs: number;
  waitMs: number;
  critical: boolean;
}

export type ReviewRiskLevel = "high" | "medium" | "info";

export interface ReviewRisk {
  level: ReviewRiskLevel;
  message: string;
}

export interface ReviewComparison {
  baselineName: string;
  targetName: string;
  baselineCompletionMs: number;
  targetCompletionMs: number;
  deltaMs: number;
  outcome: "faster" | "slower" | "equal";
  changes: string[];
}

/** 生成那一刻固化下来的只读评审材料。 */
export interface ReviewPackage {
  schemaVersion: 1;
  generatedAt: number;
  sourceType: "project" | "snapshot";
  projectTitle: string;
  sourceName: string;
  mode: SimulationMode;
  concurrencyLimit: number | null;
  nodeCount: number;
  completionMs: number;
  criticalPathNames: string[];
  params: ReviewNodeParam[];
  timeline: ReviewTimelineRow[];
  risks: ReviewRisk[];
  comparison?: ReviewComparison;
  /** 生成时记录的模型口径，随材料一起冻结。 */
  modelNote: string;
}

/** 生成前的就绪检查结果；链路不完整时说明缺什么。 */
export interface ReviewReadiness {
  ready: boolean;
  /** 阻止生成的硬性问题，例如循环依赖、参数非法。 */
  blockers: string[];
  /** 不阻止生成但需要提醒的问题，例如项目里还没有节点。 */
  concerns: string[];
}

const MODE_LABEL: Record<SimulationMode, string> = {
  low: "乐观（低波动）",
  expected: "预期（中位估算）",
  high: "保守（高波动）",
};

const MODEL_NOTE =
  "耗时 = 超时截断后的请求耗时 × 失败重试概率 + 指数退避（200ms 起、封顶 2s）；降级开销按最终失败概率加权；并发上限计入资源排队。所有数值均为确定性估算，不发送真实请求。";

export function modeLabel(mode: SimulationMode): string {
  return MODE_LABEL[mode];
}

function nameById(nodes: RequestNode[]): (id: string) => string | undefined {
  const map = new Map(nodes.map((node) => [node.id, node.name]));
  return (id: string) => map.get(id);
}

/**
 * 判断当前链路是否具备完整的推演结果。
 * 校验的是来源快照/项目自身，而不是工作区当前状态，保证评审对象明确。
 */
export function assessReviewReadiness(source: ReviewSource): ReviewReadiness {
  const nodes =
    source.kind === "snapshot" ? source.snapshot.nodes : source.project.nodes;
  const blockers: string[] = [];
  const concerns: string[] = [];

  if (nodes.length === 0) {
    concerns.push("当前链路还没有请求节点，材料将只包含空的预算框架。");
  }

  if (source.kind === "snapshot") {
    // 快照是上一次通过校验后保存的，结构问题通常已被拦截，这里只做轻量复核。
    const ids = new Set(nodes.map((node) => node.id));
    const missingDep = nodes.find((node) =>
      node.dependencyIds.some((id) => !ids.has(id)),
    );
    if (missingDep)
      blockers.push(
        `快照中的「${missingDep.name}」引用了已不存在的前置节点，无法还原完整时序。`,
      );
    if (
      source.snapshot.criticalPath.length === 0 ||
      !Number.isFinite(source.snapshot.completionMs)
    ) {
      blockers.push("该快照缺少完成预算或关键链路结果，请重新推演后再保存。");
    }
  } else {
    const analysis = analyzeGraph(source.project);
    blockers.push(...analysis.validation.errors);
    if (analysis.validation.errors.length === 0 && nodes.length > 0) {
      const result = simulateProject(source.project, "expected");
      if (result.entries.length !== nodes.length)
        blockers.push("推演未能覆盖全部节点，请检查依赖配置后重试。");
    }
  }

  return { ready: blockers.length === 0, blockers, concerns };
}

function toParams(nodes: RequestNode[]): ReviewNodeParam[] {
  const getName = nameById(nodes);
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    durationMs: node.durationMs,
    jitterMs: node.jitterMs,
    timeoutMs: node.timeoutMs,
    retryCount: node.retryCount,
    failureRate: node.failureRate,
    ...(node.fallbackNodeId
      ? { fallbackName: getName(node.fallbackNodeId) }
      : {}),
    dependencyNames: node.dependencyIds
      .map((id) => getName(id))
      .filter((name): name is string => Boolean(name)),
  }));
}

function toTimeline(
  nodes: RequestNode[],
  result: SimulationResult,
): ReviewTimelineRow[] {
  const critical = new Set(result.criticalPath);
  return result.entries.map((entry: TimelineEntry) => ({
    name: nodes.find((node) => node.id === entry.nodeId)?.name ?? entry.nodeId,
    startMs: entry.startMs,
    endMs: entry.endMs,
    modeledDurationMs: entry.modeledDurationMs,
    waitMs: entry.waitMs,
    critical: critical.has(entry.nodeId),
  }));
}

function deriveRisks(
  nodes: RequestNode[],
  result: SimulationResult,
): ReviewRisk[] {
  const risks: ReviewRisk[] = [];
  for (const node of nodes) {
    if (node.retryCount > 3)
      risks.push({
        level: "high",
        message: `${node.name}：重试 ${node.retryCount} 次，失败时会显著放大尾延迟。`,
      });
    else if (node.retryCount > 0 && node.failureRate >= 5)
      risks.push({
        level: "medium",
        message: `${node.name}：失败率 ${node.failureRate}% 且配置了 ${node.retryCount} 次重试，注意叠加耗时。`,
      });
    if (node.timeoutMs > 0 && node.durationMs + node.jitterMs > node.timeoutMs)
      risks.push({
        level: "medium",
        message: `${node.name}：高波动下（${node.durationMs + node.jitterMs}ms）会超过超时 ${node.timeoutMs}ms，触发截断与重试。`,
      });
    if (node.failureRate >= 10)
      risks.push({
        level: "medium",
        message: `${node.name}：失败率达到 ${node.failureRate}%，建议确认降级链路是否兜底。`,
      });
  }
  const queued = result.entries.filter((entry) => entry.waitMs > 0);
  if (queued.length > 0) {
    const longest = queued.reduce((best, entry) =>
      entry.waitMs > best.waitMs ? entry : best,
    );
    const name =
      nodes.find((node) => node.id === longest.nodeId)?.name ?? longest.nodeId;
    risks.push({
      level: "info",
      message: `并发上限导致排队，最长等待出现在「${name}」，约 ${Math.round(longest.waitMs)}ms。`,
    });
  }
  for (const warning of result.warnings)
    risks.push({ level: "info", message: warning });
  return risks;
}

/** 把一份方案快照还原成可推演的临时项目。 */
function projectFromSnapshot(
  owner: LatencyProject,
  snapshot: ScenarioSnapshot,
): LatencyProject {
  return {
    ...owner,
    nodes: structuredClone(snapshot.nodes),
    concurrencyLimit: snapshot.concurrencyLimit,
    // 还原出的项目仅用于即时推演，不带入工作区里的其它快照。
    scenarios: [],
    updatedAt: snapshot.createdAt,
  };
}

/**
 * 生成只读评审材料。
 * 材料在这一刻构建并固化；调用方拿到的是纯数据，之后改动工程参数不会影响它。
 * 比对基准可选：传入时会附上与选定方案的差异说明。
 */
export function buildReviewPackage(
  source: ReviewSource,
  options: { mode?: SimulationMode; baselineSnapshot?: ScenarioSnapshot } = {},
): ReviewPackage {
  const readiness = assessReviewReadiness(source);
  if (!readiness.ready)
    throw new Error(
      `当前链路不具备完整推演结果，无法生成评审材料：${readiness.blockers.join("；")}`,
    );

  const owner = source.project;
  const mode =
    source.kind === "snapshot"
      ? (source.snapshot.mode ?? options.mode ?? "expected")
      : (options.mode ?? "expected");

  let nodes: RequestNode[];
  let concurrencyLimit: number | null;
  let sourceName: string;
  let result: SimulationResult;

  if (source.kind === "snapshot") {
    const { snapshot } = source;
    nodes = snapshot.nodes;
    concurrencyLimit = snapshot.concurrencyLimit;
    sourceName = snapshot.name;
    const restored = projectFromSnapshot(owner, snapshot);
    const simulated = simulateProject(restored, mode);
    // 以保存时固化的完成预算与关键链路为准，重算结果仅用于补齐时序与风险。
    result = {
      ...simulated,
      completionMs: snapshot.completionMs,
      criticalPath: [...snapshot.criticalPath],
    };
  } else {
    nodes = source.project.nodes;
    concurrencyLimit = source.project.concurrencyLimit;
    sourceName = `${source.project.title} · 当前参数`;
    result = simulateProject(source.project, mode);
  }

  const getName = nameById(nodes);
  const criticalPathNames = result.criticalPath
    .map((id) => getName(id))
    .filter((name): name is string => Boolean(name));

  let comparison: ReviewComparison | undefined;
  if (options.baselineSnapshot) {
    const baseline = options.baselineSnapshot;
    const targetSnapshot: ScenarioSnapshot =
      source.kind === "snapshot"
        ? source.snapshot
        : {
            id: "review-current",
            name: sourceName,
            createdAt: Date.now(),
            concurrencyLimit,
            nodes: structuredClone(nodes),
            completionMs: result.completionMs,
            criticalPath: [...result.criticalPath],
            mode,
          };
    const diff = compareScenarios(baseline, targetSnapshot);
    comparison = {
      baselineName: baseline.name,
      targetName: targetSnapshot.name,
      baselineCompletionMs: baseline.completionMs,
      targetCompletionMs: targetSnapshot.completionMs,
      deltaMs: diff.deltaMs,
      outcome: diff.outcome,
      changes: diff.changes,
    };
  }

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    sourceType: source.kind,
    projectTitle: owner.title,
    sourceName,
    mode,
    concurrencyLimit,
    nodeCount: nodes.length,
    completionMs: result.completionMs,
    criticalPathNames,
    params: toParams(nodes),
    timeline: toTimeline(nodes, result),
    risks: deriveRisks(nodes, result),
    ...(comparison ? { comparison } : {}),
    modelNote: MODEL_NOTE,
  };
}
