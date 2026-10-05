import { useCallback, useMemo, useState } from "react";
import {
  assessReviewReadiness,
  buildReviewPackage,
  type ReviewPackage,
  type ReviewReadiness,
  type ReviewSource,
} from "./export/reviewPackage";
import {
  downloadReviewHtml,
  type DownloadedReview,
} from "./export/reviewDownload";
import type {
  LatencyProject,
  ScenarioSnapshot,
  SimulationMode,
} from "../../shared/domain/types";

export type ReviewSourceKind = "project" | "snapshot";

export interface UseReviewExport {
  sourceKind: ReviewSourceKind;
  setSourceKind: (kind: ReviewSourceKind) => void;
  snapshotId: string;
  setSnapshotId: (id: string) => void;
  mode: SimulationMode;
  setMode: (mode: SimulationMode) => void;
  baselineId: string;
  setBaselineId: (id: string) => void;
  selectedSnapshot?: ScenarioSnapshot;
  baselineSnapshot?: ScenarioSnapshot;
  readiness: ReviewReadiness;
  /** 实时预览：会随参数变化；只有点击导出的那一刻才会被冻结。 */
  preview?: ReviewPackage;
  exported: DownloadedReview | null;
  exportError: string;
  generate: () => Promise<boolean>;
}

export function useReviewExport(
  project: LatencyProject,
  currentMode: SimulationMode,
): UseReviewExport {
  const [sourceKind, setSourceKind] = useState<ReviewSourceKind>("project");
  const [snapshotId, setSnapshotId] = useState("");
  const [mode, setMode] = useState<SimulationMode>(currentMode);
  const [baselineId, setBaselineId] = useState("");
  const [exported, setExported] = useState<DownloadedReview | null>(null);
  const [exportError, setExportError] = useState("");

  // 切换项目后兜底选择第一个快照，避免拿到不存在的 id。
  const scenarios = project.scenarios;
  const effectiveSnapshotId =
    snapshotId && scenarios.some((item) => item.id === snapshotId)
      ? snapshotId
      : (scenarios[0]?.id ?? "");
  const selectedSnapshot = scenarios.find(
    (item) => item.id === effectiveSnapshotId,
  );
  const baselineSnapshot = scenarios.find((item) => item.id === baselineId);

  const source: ReviewSource = useMemo(
    () =>
      sourceKind === "snapshot" && selectedSnapshot
        ? { kind: "snapshot" as const, project, snapshot: selectedSnapshot }
        : { kind: "project" as const, project },
    [sourceKind, selectedSnapshot, project],
  );

  // 推演是轻量同步计算，直接在渲染期求值；预览只用于展示，真正的冻结发生在点击导出时。
  const readiness = assessReviewReadiness(source);

  // 快照自身锁定了情境；项目来源才使用可切换的 mode。
  const effectiveMode =
    sourceKind === "snapshot" && selectedSnapshot
      ? (selectedSnapshot.mode ?? "expected")
      : mode;

  let preview: ReviewPackage | undefined;
  if (readiness.ready) {
    try {
      preview = buildReviewPackage(source, {
        mode: effectiveMode,
        ...(baselineSnapshot ? { baselineSnapshot } : {}),
      });
    } catch {
      preview = undefined;
    }
  }

  const generate = useCallback(async () => {
    setExportError("");
    if (!readiness.ready) {
      setExportError("当前链路不具备完整推演结果，请先按提示补齐后再导出。");
      return false;
    }
    try {
      // 在点击这一刻重新构建，时间戳与数据在此冻结。
      const frozen = buildReviewPackage(source, {
        mode: effectiveMode,
        ...(baselineSnapshot ? { baselineSnapshot } : {}),
      });
      const meta = await downloadReviewHtml(frozen);
      setExported(meta);
      return true;
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "评审材料生成失败，请重试。",
      );
      return false;
    }
  }, [readiness.ready, source, effectiveMode, baselineSnapshot]);

  return {
    sourceKind,
    setSourceKind,
    snapshotId: effectiveSnapshotId,
    setSnapshotId,
    mode: effectiveMode,
    setMode,
    baselineId,
    setBaselineId,
    selectedSnapshot,
    baselineSnapshot,
    readiness,
    preview,
    exported,
    exportError,
    generate,
  };
}
