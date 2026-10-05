import type {
  ReviewPackage,
  ReviewRisk,
  ReviewRiskLevel,
} from "./reviewPackage";

/**
 * 评审材料渲染器：输出单个自包含 HTML 文件。
 * 不引用任何外部字体、脚本、样式或图片，对方双击即可离线打开。
 * 所有进入 HTML 的动态内容都经过 escapeHtml。
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

function formatStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const RISK_META: Record<ReviewRiskLevel, { label: string; cls: string }> = {
  high: { label: "高风险", cls: "risk-high" },
  medium: { label: "需关注", cls: "risk-medium" },
  info: { label: "提示", cls: "risk-info" },
};

function riskSection(risks: ReviewRisk[]): string {
  if (!risks.length)
    return `<p class="muted">当前参数范围内未发现明显风险。</p>`;
  const order: ReviewRiskLevel[] = ["high", "medium", "info"];
  return order
    .map((level) => {
      const items = risks.filter((risk) => risk.level === level);
      if (!items.length) return "";
      const meta = RISK_META[level];
      return `<div class="risk-group">
        <h4><span class="risk-dot ${meta.cls}"></span>${meta.label}<small>${items.length}</small></h4>
        <ul>${items
          .map((risk) => `<li>${escapeHtml(risk.message)}</li>`)
          .join("")}</ul>
      </div>`;
    })
    .join("");
}

function paramsTable(pkg: ReviewPackage): string {
  if (!pkg.params.length)
    return `<p class="muted">该链路在生成时没有请求节点。</p>`;
  const rows = pkg.params
    .map((node) => {
      const deps = node.dependencyNames.length
        ? node.dependencyNames.map((name) => escapeHtml(name)).join("、")
        : '<span class="muted">入口节点</span>';
      const fallback = node.fallbackName
        ? escapeHtml(node.fallbackName)
        : '<span class="muted">—</span>';
      return `<tr>
        <td><b>${escapeHtml(node.name)}</b></td>
        <td class="num">${node.durationMs}</td>
        <td class="num">±${node.jitterMs}</td>
        <td class="num">${node.timeoutMs}</td>
        <td class="num">${node.retryCount}</td>
        <td class="num">${node.failureRate}%</td>
        <td>${deps}</td>
        <td>${fallback}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>
      <th>请求节点</th><th>耗时 ms</th><th>波动 ms</th><th>超时 ms</th>
      <th>重试</th><th>失败率</th><th>前置依赖</th><th>降级目标</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function gantt(pkg: ReviewPackage): string {
  if (!pkg.timeline.length)
    return `<p class="muted">没有可排布的执行时序。</p>`;
  const max = Math.max(1, pkg.completionMs);
  const marks = [0, 0.25, 0.5, 0.75, 1]
    .map((mark) => {
      const pos = mark * 100;
      return `<span class="tick" style="left:${pos}%"><i>${formatMs(max * mark)}</i></span>`;
    })
    .join("");
  const rows = pkg.timeline
    .map((row) => {
      const start = (row.startMs / max) * 100;
      const width = Math.max(1.6, (row.modeledDurationMs / max) * 100);
      const waitWidth = (row.waitMs / max) * 100;
      const waitStart = ((row.startMs - row.waitMs) / max) * 100;
      return `<div class="g-row">
        <div class="g-name">${escapeHtml(row.name)}${row.critical ? '<em class="crit-tag">关键</em>' : ""}</div>
        <div class="g-track">
          ${row.waitMs > 0 ? `<i class="g-wait" style="left:${waitStart}%;width:${waitWidth}%"></i>` : ""}
          <i class="g-bar ${row.critical ? "is-critical" : ""}" style="left:${start}%;width:${Math.min(width, 100 - start)}%"><b>${formatMs(row.modeledDurationMs)}</b></i>
        </div>
        <div class="g-end">${formatMs(row.endMs)}</div>
      </div>`;
    })
    .join("");
  return `<div class="gantt">
    <div class="g-axis"><span></span><div class="g-track">${marks}</div><span></span></div>
    ${rows}
    <div class="legend">
      <span><i class="swatch sw-bar"></i>请求耗时</span>
      <span><i class="swatch sw-crit"></i>关键路径</span>
      <span><i class="swatch sw-wait"></i>排队等待</span>
    </div>
  </div>`;
}

function comparisonBlock(pkg: ReviewPackage): string {
  const cmp = pkg.comparison;
  if (!cmp) return "";
  const deltaCls = cmp.outcome === "slower" ? "delta-bad" : "delta-good";
  const verdict =
    cmp.outcome === "equal"
      ? "两方案预算持平"
      : cmp.outcome === "faster"
        ? "评审方案更快"
        : "评审方案更慢";
  const changes = cmp.changes.length
    ? `<ul class="change-list">${cmp.changes
        .map((change) => `<li>${escapeHtml(change)}</li>`)
        .join("")}</ul>`
    : '<p class="muted">两份方案的关键参数一致，差异主要来自推演情境或依赖排布。</p>';
  return `<section class="block">
    <h2><span class="idx">05</span>与选定方案的差异说明</h2>
    <div class="compare-row">
      <div class="compare-card">
        <small>选定基准 · ${escapeHtml(cmp.baselineName)}</small>
        <strong>${formatMs(cmp.baselineCompletionMs)}</strong>
      </div>
      <div class="compare-delta ${deltaCls}">
        <small>${verdict}</small>
        <strong>${cmp.outcome === "equal" ? "±0 ms" : `${cmp.deltaMs > 0 ? "+" : ""}${Math.round(cmp.deltaMs)} ms`}</strong>
      </div>
      <div class="compare-card accent">
        <small>本材料方案 · ${escapeHtml(cmp.targetName)}</small>
        <strong>${formatMs(cmp.targetCompletionMs)}</strong>
      </div>
    </div>
    <h3 class="sub">参数差异明细</h3>
    ${changes}
  </section>`;
}

export function renderReviewHtml(pkg: ReviewPackage): string {
  const critical = pkg.criticalPathNames.length
    ? pkg.criticalPathNames
        .map((name) => escapeHtml(name))
        .join('<i class="arrow">→</i>')
    : '<span class="muted">无</span>';
  const highCount = pkg.risks.filter((risk) => risk.level === "high").length;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>方案评审 · ${escapeHtml(pkg.projectTitle)} · ${escapeHtml(pkg.sourceName)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
  <header class="hero">
    <div class="hero-top">
      <span class="brand">LATENCY<b>LAB</b> · 离线评审材料</span>
      <span class="freeze-badge">只读快照 · ${escapeHtml(formatStamp(pkg.generatedAt))} 生成</span>
    </div>
    <h1>${escapeHtml(pkg.projectTitle)}</h1>
    <p class="source">${escapeHtml(pkg.sourceName)}${pkg.sourceType === "snapshot" ? "（方案快照）" : "（当前项目参数）"}</p>
    <div class="meta-row">
      <span>预算情境 <b>${escapeHtml(labelOfMode(pkg.mode))}</b></span>
      <span>最大并发 <b>${pkg.concurrencyLimit ? `${pkg.concurrencyLimit} 路` : "不限"}</b></span>
      <span>请求节点 <b>${pkg.nodeCount}</b></span>
    </div>
  </header>

  <div class="summary">
    <div class="stat stat-primary">
      <small>页面完成预算</small>
      <strong>${formatMs(pkg.completionMs)}</strong>
    </div>
    <div class="stat">
      <small>关键链路</small>
      <strong>${pkg.criticalPathNames.length} <em>nodes</em></strong>
    </div>
    <div class="stat">
      <small>风险提示</small>
      <strong>${pkg.risks.length} <em>items${highCount ? ` · ${highCount} 高风险` : ""}</em></strong>
    </div>
  </div>

  <section class="block">
    <h2><span class="idx">01</span>关键参数</h2>
    ${paramsTable(pkg)}
  </section>

  <section class="block">
    <h2><span class="idx">02</span>执行时序</h2>
    ${gantt(pkg)}
  </section>

  <section class="block">
    <h2><span class="idx">03</span>关键链路</h2>
    <div class="critical-chain">${critical}</div>
  </section>

  <section class="block">
    <h2><span class="idx">04</span>告警与风险提示</h2>
    ${riskSection(pkg.risks)}
  </section>

  ${comparisonBlock(pkg)}

  <footer class="foot">
    <p>${escapeHtml(pkg.modelNote)}</p>
    <p class="freeze-note">本材料为 <b>${escapeHtml(formatStamp(pkg.generatedAt))}</b> 生成时刻的只读快照，不包含可编辑的工程数据；此后调整任何参数都不会改变本文件。文件可完全离线打开，不依赖网络。</p>
  </footer>
</div>
</body>
</html>`;
}

function labelOfMode(mode: ReviewPackage["mode"]): string {
  return mode === "low"
    ? "乐观（低波动）"
    : mode === "high"
      ? "保守（高波动）"
      : "预期（中位估算）";
}

const STYLES = `
:root{--ink:#172424;--muted:#7c867f;--line:#e3e7e0;--forest:#203c35;--acid:#d5fa61;--paper:#fff;--bg:#f4f5f1;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
 font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased;}
.page{max-width:960px;margin:0 auto;padding:32px 28px 56px;}
.hero{background:var(--forest);color:#eef3ea;border-radius:18px;padding:26px 28px;}
.hero-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}
.brand{font-size:11px;letter-spacing:1.5px;color:#9fb3a8;font-weight:600;}
.brand b{color:var(--acid);}
.freeze-badge{font-size:11px;background:#ffffff14;border:1px solid #ffffff26;border-radius:999px;padding:4px 12px;color:#dfe7df;}
.hero h1{margin:18px 0 4px;font-size:28px;letter-spacing:-.5px;}
.source{margin:0;color:#aebfb4;}
.meta-row{display:flex;gap:24px;flex-wrap:wrap;margin-top:18px;font-size:12px;color:#aebfb4;}
.meta-row b{color:#f1f5ee;font-weight:700;margin-left:6px;}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0 8px;}
.stat{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:16px 18px;}
.stat small{display:block;color:var(--muted);font-size:11px;letter-spacing:.5px;}
.stat strong{display:block;margin-top:6px;font-size:26px;letter-spacing:-.5px;}
.stat strong em{font-style:normal;font-size:12px;color:var(--muted);font-weight:500;}
.stat-primary{background:var(--acid);border-color:#c8ec4d;}
.block{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin-top:18px;}
.block h2{margin:0 0 16px;font-size:17px;display:flex;align-items:center;gap:10px;}
.idx{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--forest);color:var(--acid);font-size:11px;}
.sub{font-size:13px;margin:20px 0 8px;color:#33443e;}
.muted{color:var(--muted);}
.table-wrap{overflow-x:auto;}
.data-table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;}
.data-table th{text-align:left;color:var(--muted);font-weight:600;font-size:11px;padding:8px 10px;border-bottom:1px solid var(--line);}
.data-table td{padding:9px 10px;border-bottom:1px solid #f0f2ee;}
.data-table tbody tr:last-child td{border-bottom:0;}
.data-table .num{text-align:right;font-variant-numeric:tabular-nums;}
.gantt{margin-top:4px;}
.g-axis,.g-row{display:grid;grid-template-columns:168px 1fr 76px;gap:12px;align-items:center;}
.g-axis{margin-bottom:8px;color:var(--muted);font-size:10px;}
.tick{position:absolute;top:0;}
.tick i{position:absolute;transform:translateX(-50%);font-style:normal;color:var(--muted);}
.g-row{padding:6px 0;}
.g-name{font-size:13px;display:flex;align-items:center;gap:8px;}
.crit-tag{font-style:normal;font-size:10px;background:var(--forest);color:var(--acid);border-radius:6px;padding:1px 6px;}
.g-track{position:relative;height:26px;background:repeating-linear-gradient(90deg,#f3f5f0 0 1px,transparent 1px 25%);border-radius:7px;}
.g-axis .g-track{height:14px;background:none;}
.g-bar{position:absolute;top:3px;height:20px;border-radius:6px;background:#9db7a4;display:flex;align-items:center;padding:0 7px;min-width:2px;}
.g-bar b{font-size:10px;color:#1d332c;font-weight:700;font-style:normal;white-space:nowrap;}
.g-bar.is-critical{background:var(--forest);}
.g-bar.is-critical b{color:var(--acid);}
.g-wait{position:absolute;top:8px;height:10px;border-radius:5px;background:repeating-linear-gradient(45deg,#d9ddD2,#d9ddd2 4px,#eef0e9 4px,#eef0e9 8px);}
.g-end{font-size:12px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums;}
.legend{display:flex;gap:18px;margin-top:14px;font-size:11px;color:var(--muted);}
.swatch{display:inline-block;width:12px;height:12px;border-radius:4px;margin-right:6px;vertical-align:-1px;}
.sw-bar{background:#9db7a4;}.sw-crit{background:var(--forest);}.sw-wait{background:#d4d8cd;}
.critical-chain{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:14px;}
.critical-chain b{font-weight:700;}
.arrow{color:var(--muted);font-style:normal;margin:0 2px;}
.risk-group{margin-bottom:14px;}
.risk-group:last-child{margin-bottom:0;}
.risk-group h4{margin:0 0 6px;font-size:13px;display:flex;align-items:center;gap:8px;}
.risk-group h4 small{color:var(--muted);font-weight:500;}
.risk-dot{width:9px;height:9px;border-radius:50%;display:inline-block;}
.risk-high{background:#d95745;}.risk-medium{background:#e3a83c;}.risk-info{background:#9db7a4;}
.risk-group ul{margin:0;padding-left:20px;}
.risk-group li{margin:3px 0;font-size:13px;}
.compare-row{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:stretch;}
.compare-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;}
.compare-card small{display:block;color:var(--muted);font-size:11px;margin-bottom:6px;}
.compare-card strong{font-size:22px;}
.compare-card.accent{background:#f6fbe4;border-color:#d9f0a0;}
.compare-delta{display:flex;flex-direction:column;justify-content:center;align-items:center;padding:0 8px;min-width:120px;}
.compare-delta small{font-size:11px;color:var(--muted);}
.compare-delta strong{font-size:22px;}
.delta-good strong{color:#3f7d3a;}.delta-bad strong{color:#c8493a;}
.change-list{margin:0;padding-left:20px;}
.change-list li{margin:3px 0;font-size:13px;}
.foot{margin-top:22px;color:var(--muted);font-size:12px;}
.foot p{margin:6px 0;}
.freeze-note{padding-top:8px;border-top:1px dashed var(--line);}
@media print{body{background:#fff;} .page{max-width:none;padding:0;} .block,.hero{break-inside:avoid;}}
@media (max-width:680px){.summary{grid-template-columns:1fr;}.g-axis,.g-row{grid-template-columns:110px 1fr 56px;}.compare-row{grid-template-columns:1fr;}}
`;
