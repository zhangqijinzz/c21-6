import { analyzeGraph } from "./graph";
import type {
  LatencyProject,
  RequestNode,
  SimulationMode,
  SimulationResult,
} from "./types";

export interface ReviewReadiness {
  ready: boolean;
  missing: string[];
}

export interface ReviewComparisonInput {
  baselineLabel: string;
  subjectLabel: string;
  baselineMs: number;
  subjectMs: number;
  changes: string[];
}

export interface ReviewReportInput {
  projectTitle: string;
  sourceLabel: string;
  nodes: RequestNode[];
  concurrencyLimit: number | null;
  result: SimulationResult;
  generatedAt: number;
  comparison?: ReviewComparisonInput;
}

export interface ReviewReportNode {
  name: string;
  durationMs: number;
  jitterMs: number;
  timeoutMs: number;
  retryCount: number;
  failureRate: number;
  dependencies: string[];
  fallbackName?: string;
}

export interface ReviewTimelineRow {
  name: string;
  startMs: number;
  endMs: number;
  modeledDurationMs: number;
  waitMs: number;
  critical: boolean;
}

export interface ReviewReport {
  projectTitle: string;
  sourceLabel: string;
  generatedAt: number;
  modeLabel: string;
  concurrencyLabel: string;
  completionMs: number;
  nodeCount: number;
  criticalPath: string[];
  warnings: string[];
  nodes: ReviewReportNode[];
  timeline: ReviewTimelineRow[];
  comparison?: {
    baselineLabel: string;
    subjectLabel: string;
    baselineMs: number;
    subjectMs: number;
    deltaMs: number;
    outcome: "faster" | "slower" | "equal";
    changes: string[];
  };
}

const MODE_LABELS: Record<SimulationMode, string> = {
  low: "乐观 · 低波动",
  expected: "预期 · 中位估算",
  high: "保守 · 高波动",
};

export function assessReviewReadiness(
  project: LatencyProject,
  result: SimulationResult,
): ReviewReadiness {
  const missing: string[] = [];
  if (!project.nodes.length)
    missing.push("链路中还没有请求节点，请先在「请求编排」中添加节点");
  for (const error of analyzeGraph(project).validation.errors)
    missing.push(`链路配置问题：${error}`);
  if (project.nodes.length && result.entries.length !== project.nodes.length)
    missing.push(
      `推演结果不完整：${project.nodes.length} 个节点只得到 ${result.entries.length} 条时序记录，请修复链路后重新运行推演`,
    );
  return { ready: missing.length === 0, missing };
}

export function buildReviewReport(input: ReviewReportInput): ReviewReport {
  const nameById = new Map(input.nodes.map((node) => [node.id, node.name]));
  const critical = new Set(input.result.criticalPath);
  return {
    projectTitle: input.projectTitle,
    sourceLabel: input.sourceLabel,
    generatedAt: input.generatedAt,
    modeLabel: MODE_LABELS[input.result.mode],
    concurrencyLabel: input.concurrencyLimit
      ? `${input.concurrencyLimit} 路并发`
      : "不限并发",
    completionMs: input.result.completionMs,
    nodeCount: input.nodes.length,
    criticalPath: input.result.criticalPath.map((id) => nameById.get(id) ?? id),
    warnings: [...input.result.warnings],
    nodes: input.nodes.map((node) => ({
      name: node.name,
      durationMs: node.durationMs,
      jitterMs: node.jitterMs,
      timeoutMs: node.timeoutMs,
      retryCount: node.retryCount,
      failureRate: node.failureRate,
      dependencies: node.dependencyIds.map((id) => nameById.get(id) ?? id),
      ...(node.fallbackNodeId
        ? {
            fallbackName:
              nameById.get(node.fallbackNodeId) ?? node.fallbackNodeId,
          }
        : {}),
    })),
    timeline: input.result.entries.map((entry) => ({
      name: nameById.get(entry.nodeId) ?? entry.nodeId,
      startMs: entry.startMs,
      endMs: entry.endMs,
      modeledDurationMs: entry.modeledDurationMs,
      waitMs: entry.waitMs,
      critical: critical.has(entry.nodeId),
    })),
    ...(input.comparison
      ? {
          comparison: {
            ...input.comparison,
            deltaMs: input.comparison.subjectMs - input.comparison.baselineMs,
            outcome:
              input.comparison.subjectMs < input.comparison.baselineMs
                ? ("faster" as const)
                : input.comparison.subjectMs > input.comparison.baselineMs
                  ? ("slower" as const)
                  : ("equal" as const),
          },
        }
      : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMs(value: number): string {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function reviewFileName(
  projectTitle: string,
  generatedAt: number,
): string {
  const date = new Date(generatedAt);
  const safeTitle =
    projectTitle.trim().replace(/[\\/:*?"<>|\s]+/g, "-") || "链路";
  return `评审材料-${safeTitle}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.html`;
}

const REPORT_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #eef1ea; color: #2c3a32; font: 13px/1.65 -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; }
  .page { max-width: 960px; margin: 0 auto; padding: 40px 28px 56px; }
  .masthead { border-bottom: 3px solid #243c34; padding-bottom: 18px; }
  .kicker { color: #7a8a7d; font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; }
  h1 { margin-top: 8px; color: #1a2822; font-size: 26px; letter-spacing: -0.5px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px; color: #66756a; font-size: 12px; }
  .meta b { color: #2c3a32; font-weight: 600; }
  .readonly-note { margin-top: 16px; padding: 10px 14px; background: #f4f7ec; border: 1px solid #dfe8c8; border-radius: 8px; color: #5c6b46; font-size: 12px; }
  section { margin-top: 30px; }
  h2 { display: flex; align-items: baseline; gap: 10px; color: #1a2822; font-size: 16px; }
  h2 small { color: #93a095; font-size: 11px; font-weight: 400; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 14px; }
  .card { padding: 14px 16px; background: #fff; border: 1px solid #dde4d8; border-radius: 10px; }
  .card span { display: block; color: #8b978d; font-size: 11px; }
  .card strong { display: block; margin-top: 6px; color: #243c34; font-size: 20px; }
  .card em { display: block; color: #9aa69c; font-size: 11px; font-style: normal; }
  .path { margin-top: 12px; padding: 14px 16px; background: #243c34; border-radius: 10px; color: #d9f66d; font-size: 14px; font-weight: 600; }
  .path small { display: block; margin-bottom: 6px; color: #9db3a4; font-size: 11px; font-weight: 400; }
  ul.warnings { margin-top: 12px; list-style: none; }
  ul.warnings li { margin-top: 8px; padding: 10px 14px; background: #fff8ef; border: 1px solid #f0dfc2; border-radius: 8px; color: #7a5c2e; font-size: 12px; }
  .all-clear { margin-top: 12px; padding: 10px 14px; background: #f0f6e7; border: 1px solid #dce8c5; border-radius: 8px; color: #5c7040; font-size: 12px; }
  table { width: 100%; margin-top: 12px; background: #fff; border: 1px solid #dde4d8; border-radius: 10px; border-collapse: separate; border-spacing: 0; overflow: hidden; }
  th, td { padding: 8px 12px; text-align: left; font-size: 12px; border-bottom: 1px solid #e8ede3; }
  th { background: #f4f6f0; color: #7a877c; font-size: 11px; font-weight: 600; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tag { display: inline-block; padding: 1px 7px; background: #eef3e4; border-radius: 99px; color: #5c7040; font-size: 11px; }
  .timeline { margin-top: 12px; padding: 16px; background: #fff; border: 1px solid #dde4d8; border-radius: 10px; }
  .tl-row { display: grid; grid-template-columns: 130px 1fr 64px; gap: 10px; align-items: center; margin-top: 10px; }
  .tl-name { overflow: hidden; color: #3c4a41; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .tl-track { position: relative; height: 18px; background: #f0f3ec; border-radius: 5px; }
  .tl-wait { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(45deg, #e4d9b8 0 4px, #efe8d2 4px 8px); border-radius: 5px; }
  .tl-bar { position: absolute; top: 3px; bottom: 3px; min-width: 3px; background: #7a9b6d; border-radius: 4px; }
  .tl-bar.critical { background: #243c34; box-shadow: inset 0 -3px 0 #d9f66d; }
  .tl-end { color: #7a877c; font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
  .legend { display: flex; gap: 16px; margin-top: 14px; color: #8b978d; font-size: 11px; }
  .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 5px; border-radius: 3px; vertical-align: -1px; }
  .delta-hero { margin-top: 12px; padding: 16px; background: #fff; border: 1px solid #dde4d8; border-radius: 10px; }
  .delta-hero strong { font-size: 22px; }
  .faster { color: #4c7a3f; } .slower { color: #b0563f; } .equal { color: #66756a; }
  footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #d8dfd3; color: #93a095; font-size: 11px; line-height: 1.8; }
  @media print { body { background: #fff; } .page { padding: 0; } }
`;

export function renderReviewHtml(report: ReviewReport): string {
  const e = escapeHtml;
  const max = Math.max(1, report.completionMs);
  const timelineRows = report.timeline
    .map((row) => {
      const waitLeft = Math.max(0, ((row.startMs - row.waitMs) / max) * 100);
      const waitWidth = (row.waitMs / max) * 100;
      const left = (row.startMs / max) * 100;
      const width = Math.min(
        Math.max(0.8, (row.modeledDurationMs / max) * 100),
        100 - left,
      );
      return `<div class="tl-row">
        <span class="tl-name">${e(row.name)}</span>
        <div class="tl-track">
          ${row.waitMs > 0 ? `<div class="tl-wait" style="left:${waitLeft.toFixed(2)}%;width:${waitWidth.toFixed(2)}%"></div>` : ""}
          <div class="tl-bar${row.critical ? " critical" : ""}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></div>
        </div>
        <span class="tl-end">${formatMs(row.endMs)}</span>
      </div>`;
    })
    .join("\n");

  const parameterRows = report.nodes
    .map(
      (node) => `<tr>
        <td><b>${e(node.name)}</b></td>
        <td class="num">${node.durationMs} ms</td>
        <td class="num">±${node.jitterMs} ms</td>
        <td class="num">${node.timeoutMs > 0 ? `${node.timeoutMs} ms` : "不截断"}</td>
        <td class="num">${node.retryCount} 次</td>
        <td class="num">${node.failureRate}%</td>
        <td>${node.dependencies.length ? node.dependencies.map((name) => `<span class="tag">${e(name)}</span>`).join(" ") : "入口"}</td>
        <td>${node.fallbackName ? `<span class="tag">${e(node.fallbackName)}</span>` : "—"}</td>
      </tr>`,
    )
    .join("\n");

  const timelineTableRows = report.timeline
    .map(
      (row) => `<tr>
        <td><b>${e(row.name)}</b>${row.critical ? ' <span class="tag">关键链路</span>' : ""}</td>
        <td class="num">${formatMs(row.startMs)}</td>
        <td class="num">${formatMs(row.modeledDurationMs)}</td>
        <td class="num">${row.waitMs > 0 ? formatMs(row.waitMs) : "—"}</td>
        <td class="num">${formatMs(row.endMs)}</td>
      </tr>`,
    )
    .join("\n");

  const warningsBlock = report.warnings.length
    ? `<ul class="warnings">
        ${report.warnings.map((warning) => `<li>⚠ ${e(warning)}</li>`).join("\n")}
      </ul>`
    : `<div class="all-clear">✓ 当前参数范围内未发现明显风险。</div>`;

  const comparisonBlock = report.comparison
    ? `<section>
      <h2>方案差异 <small>与选定方案对比，统一按「${e(report.modeLabel)}」假设推算</small></h2>
      <div class="delta-hero">
        <span>${e(report.comparison.baselineLabel)}：${formatMs(report.comparison.baselineMs)} → ${e(report.comparison.subjectLabel)}：${formatMs(report.comparison.subjectMs)}</span><br>
        <strong class="${report.comparison.outcome}">${
          report.comparison.outcome === "equal"
            ? "两者预算持平"
            : `${report.comparison.outcome === "faster" ? "↓" : "↑"} ${formatMs(Math.abs(report.comparison.deltaMs))} · ${report.comparison.outcome === "faster" ? "评审对象更快" : "评审对象更慢"}`
        }</strong>
      </div>
      ${
        report.comparison.changes.length
          ? `<table>
        <thead><tr><th>参数变化（基准 → 评审对象）</th></tr></thead>
        <tbody>${report.comparison.changes.map((change) => `<tr><td>${e(change)}</td></tr>`).join("\n")}</tbody>
      </table>`
          : `<div class="all-clear">两方案的节点参数与并发策略一致，差异只来自推算口径。</div>`
      }
    </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>评审材料 · ${e(report.projectTitle)}</title>
<style>${REPORT_STYLES}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <span class="kicker">LatencyLab · 离线评审材料（只读）</span>
    <h1>${e(report.projectTitle)}</h1>
    <div class="meta">
      <span>材料来源：<b>${e(report.sourceLabel)}</b></span>
      <span>生成时间：<b>${formatDateTime(report.generatedAt)}</b></span>
      <span>预算假设：<b>${e(report.modeLabel)}</b></span>
      <span>并发策略：<b>${e(report.concurrencyLabel)}</b></span>
    </div>
    <div class="readonly-note">本文件为生成那一刻的只读快照，在此之后对链路参数的任何修改都不会反映到本文件中。内容为确定性时间估算，未调用真实接口；直接双击即可离线查看，无需安装任何工具。</div>
  </header>

  <section>
    <h2>结论概览</h2>
    <div class="cards">
      <div class="card"><span>页面完成预算</span><strong>${formatMs(report.completionMs)}</strong><em>${e(report.modeLabel)}</em></div>
      <div class="card"><span>请求节点</span><strong>${report.nodeCount}</strong><em>${e(report.concurrencyLabel)}</em></div>
      <div class="card"><span>关键链路长度</span><strong>${report.criticalPath.length}</strong><em>决定完成时间的链路</em></div>
      <div class="card"><span>风险提示</span><strong>${report.warnings.length}</strong><em>${report.warnings.length ? "需在评审中确认" : "未发现明显风险"}</em></div>
    </div>
  </section>

  <section>
    <h2>关键链路 <small>最晚完成的依赖链，决定整体预算</small></h2>
    <div class="path"><small>CRITICAL PATH</small>${report.criticalPath.map((name) => e(name)).join(" → ") || "—"}</div>
  </section>

  <section>
    <h2>告警与风险提示</h2>
    ${warningsBlock}
  </section>

  <section>
    <h2>执行时序 <small>按依赖与并发预算排布，斜纹为排队等待</small></h2>
    <div class="timeline">
      ${timelineRows}
      <div class="legend">
        <span><i style="background:#7a9b6d"></i>请求耗时</span>
        <span><i style="background:#243c34"></i>关键路径</span>
        <span><i style="background:repeating-linear-gradient(45deg,#e4d9b8 0 3px,#efe8d2 3px 6px)"></i>排队等待</span>
      </div>
    </div>
    <table>
      <thead><tr><th>请求</th><th>开始</th><th>建模特耗</th><th>排队</th><th>完成</th></tr></thead>
      <tbody>${timelineTableRows}</tbody>
    </table>
  </section>

  <section>
    <h2>关键参数 <small>生成时刻的节点配置</small></h2>
    <table>
      <thead><tr><th>请求</th><th>耗时</th><th>波动</th><th>超时</th><th>重试</th><th>失败率</th><th>前置依赖</th><th>降级目标</th></tr></thead>
      <tbody>${parameterRows}</tbody>
    </table>
  </section>

  ${comparisonBlock}

  <footer>
    计算口径：耗时 = 截断后的请求耗时 × 失败重试概率 + 指数退避；降级开销按最终失败概率加权；并发上限计入资源排队。<br>
    由 LatencyLab 于 ${formatDateTime(report.generatedAt)} 生成 · 本文件不依赖网络与任何外部资源。
  </footer>
</div>
</body>
</html>
`;
}
