export function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;link.download = name;
  document.body.append(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
