/**
 * Triggers a file download through the same-origin proxy.
 * The browser's native download manager streams directly to disk — no JS
 * buffering — so the save dialog/progress appears immediately even for large
 * videos. Filename + extension are set server-side via Content-Disposition.
 */
export function downloadFile(
  url: string,
  type: "image" | "video" | "audio" = "image",
  filename?: string
): void {
  let proxyUrl = `/api/download?url=${encodeURIComponent(url)}&type=${type}`;
  if (filename) proxyUrl += `&name=${encodeURIComponent(filename)}`;
  const a = document.createElement("a");
  a.href = proxyUrl;
  a.download = ""; // server Content-Disposition provides the real filename
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
