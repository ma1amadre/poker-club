/** Скопировать текст в буфер; false — окно не даёт (WebView без доступа, нет https). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
