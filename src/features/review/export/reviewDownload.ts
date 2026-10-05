import type { ReviewPackage } from "./reviewPackage";
import { renderReviewHtml } from "./reviewHtml";

/** 对材料做一个轻量指纹，便于核对收到的文件与发出的是否一致。 */
async function fingerprint(text: string): Promise<string> {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    return Array.from(new Uint8Array(digest))
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 0;
  for (let i = 0; i < text.length; i += 1)
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFileName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "review"
  );
}

export interface DownloadedReview {
  fileName: string;
  /** 含日期与短指纹，便于在对话中引用。 */
  fingerprint: string;
  byteLength: number;
}

/**
 * 把评审材料渲染为自包含 HTML 并在本地触发下载。
 * 整个过程只读取内存里的快照数据，不访问网络、不写工程存储。
 */
export async function downloadReviewHtml(
  pkg: ReviewPackage,
): Promise<DownloadedReview> {
  const html = renderReviewHtml(pkg);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date(pkg.generatedAt);
  const day = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}`;
  const fileName = `评审材料-${safeFileName(pkg.projectTitle)}-${safeFileName(pkg.sourceName)}-${day}.html`;
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // 让浏览器有机会接管下载后再释放对象 URL。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return {
    fileName,
    fingerprint: await fingerprint(html),
    byteLength: blob.size,
  };
}
