import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  FileLock2,
  GitCompareArrows,
  RadioTower,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import type { LatencyProject, SimulationMode } from "../../shared/domain/types";
import { useReviewExport } from "./useReviewExport";
import { modeLabel } from "./export/reviewPackage";

interface Props {
  project: LatencyProject;
  currentMode: SimulationMode;
}

const MODE_OPTIONS: SimulationMode[] = ["low", "expected", "high"];

function formatMs(value: number): string {
  return value < 1000
    ? `${Math.round(value)} ms`
    : `${(value / 1000).toFixed(2)} s`;
}

export default function ReviewPanel({ project, currentMode }: Props) {
  const review = useReviewExport(project, currentMode);
  const { readiness, preview } = review;

  return (
    <section className="module-page review-page">
      <div className="module-heading">
        <div>
          <span className="eyebrow">05 / REVIEW EXPORT</span>
          <h1>离线评审材料</h1>
          <p>
            生成只读、可直接双击打开的 HTML 材料，对方无需安装工具、无需联网。
          </p>
        </div>
      </div>

      <div className="review-offline-strip">
        <span>
          <WifiOff size={15} /> 单文件离线 HTML
        </span>
        <span>
          <FileLock2 size={15} /> 不含可编辑工程数据
        </span>
        <span>
          <RadioTower size={15} /> 仅本地生成，不发送到服务器
        </span>
      </div>

      <div className="review-config">
        <div className="review-field">
          <span className="toolbar-label">材料来源</span>
          <div className="segmented-control">
            <button
              className={review.sourceKind === "project" ? "selected" : ""}
              onClick={() => review.setSourceKind("project")}
            >
              <b>当前项目</b>
              <small>此刻的参数</small>
            </button>
            <button
              className={review.sourceKind === "snapshot" ? "selected" : ""}
              onClick={() => review.setSourceKind("snapshot")}
              disabled={project.scenarios.length === 0}
              title={
                project.scenarios.length === 0
                  ? "先在方案对比里保存快照"
                  : undefined
              }
            >
              <b>方案快照</b>
              <small>已保存的版本</small>
            </button>
          </div>
        </div>

        {review.sourceKind === "snapshot" && (
          <div className="review-field">
            <span className="toolbar-label">选择快照</span>
            <span className="select-wrap review-select">
              <select
                value={review.snapshotId}
                onChange={(event) => review.setSnapshotId(event.target.value)}
              >
                {project.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name} · {formatMs(scenario.completionMs)}
                  </option>
                ))}
              </select>
            </span>
          </div>
        )}

        {review.sourceKind === "project" && (
          <div className="review-field">
            <span className="toolbar-label">预算情境</span>
            <div className="segmented-control review-modes">
              {MODE_OPTIONS.map((item) => (
                <button
                  key={item}
                  className={review.mode === item ? "selected" : ""}
                  onClick={() => review.setMode(item)}
                >
                  <b>
                    {item === "low"
                      ? "乐观"
                      : item === "high"
                        ? "保守"
                        : "预期"}
                  </b>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="review-field">
          <span className="toolbar-label">
            <GitCompareArrows size={12} /> 附加差异对比（可选）
          </span>
          <span className="select-wrap review-select">
            <select
              value={review.baselineId}
              onChange={(event) => review.setBaselineId(event.target.value)}
            >
              <option value="">不附加差异说明</option>
              {project.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  对比基准：{scenario.name}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      {!readiness.ready && (
        <div className="review-readiness review-blocked">
          <AlertTriangle size={18} />
          <div>
            <strong>当前链路不具备完整的推演结果，暂不能生成材料</strong>
            <ul>
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <span>修复以上问题后回到本页即可导出。</span>
          </div>
        </div>
      )}
      {readiness.ready && readiness.concerns.length > 0 && (
        <div className="review-readiness review-concern">
          <ShieldAlert size={18} />
          <div>
            <strong>材料可以生成，但请注意</strong>
            <ul>
              {readiness.concerns.map((concern) => (
                <li key={concern}>{concern}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {preview && (
        <div className="review-preview">
          <div className="preview-head">
            <span className="section-label">
              材料预览（随当前参数实时变化）
            </span>
            <span className="preview-mode">{modeLabel(preview.mode)}</span>
          </div>
          <div className="preview-grid">
            <article>
              <small>完成预算</small>
              <strong>{formatMs(preview.completionMs)}</strong>
            </article>
            <article>
              <small>关键链路</small>
              <strong>{preview.criticalPathNames.length} 节点</strong>
              <em>{preview.criticalPathNames.join(" → ") || "—"}</em>
            </article>
            <article>
              <small>告警风险</small>
              <strong>{preview.risks.length} 条</strong>
              <em>{preview.risks[0]?.message ?? "当前参数范围内无明显风险"}</em>
            </article>
            {preview.comparison && (
              <article>
                <small>对比差异</small>
                <strong
                  className={
                    preview.comparison.outcome === "slower"
                      ? "delta-bad"
                      : "delta-good"
                  }
                >
                  {preview.comparison.outcome === "equal"
                    ? "持平"
                    : `${preview.comparison.deltaMs > 0 ? "+" : ""}${Math.round(preview.comparison.deltaMs)} ms`}
                </strong>
                <em>
                  {preview.comparison.baselineName} →{" "}
                  {preview.comparison.targetName}
                </em>
              </article>
            )}
          </div>
        </div>
      )}

      {review.exportError && (
        <div className="review-readiness review-blocked">
          <AlertTriangle size={18} />
          <div>
            <strong>{review.exportError}</strong>
          </div>
        </div>
      )}

      <div className="review-actions">
        <button
          className="button button-primary review-export-btn"
          disabled={!readiness.ready}
          onClick={() => void review.generate()}
        >
          <FileDown size={16} /> 生成并下载离线评审材料
        </button>
        {!readiness.ready && (
          <span className="review-action-hint">需先补齐完整推演结果</span>
        )}
      </div>

      {review.exported && (
        <div className="review-done">
          <CheckCircle2 size={18} />
          <div>
            <strong>已生成：{review.exported.fileName}</strong>
            <p>
              材料已在下载时刻冻结，内容指纹
              <code>{review.exported.fingerprint}</code>（
              {(review.exported.byteLength / 1024).toFixed(0)}{" "}
              KB）。之后再修改参数，
              也不会影响这份已经发出的文件；对方直接用浏览器打开即可，无需联网。
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
