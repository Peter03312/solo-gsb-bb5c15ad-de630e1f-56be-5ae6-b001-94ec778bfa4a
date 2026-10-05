/**
 * 在正文容器（纯文本节点/元素混合）与浏览器 Selection 之间换算偏移量。
 * 偏移量按 JavaScript 字符串（UTF-16 码元）计数，与服务端 slice/start_offset 完全一致。
 */

function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/** 容器内某节点之前所有文本的码元长度 */
function offsetBefore(root: HTMLElement, node: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let current = walker.nextNode();
  while (current && current !== node) {
    total += (current.textContent?.length ?? 0);
    current = walker.nextNode();
  }
  if (current !== node) return -1;
  return total;
}

export interface SelectionRangeOffsets {
  start: number;
  end: number;
  text: string;
}

/**
 * 返回当前选区在 root 内的偏移；若选区为空、跨出 root 或反向则返回 null。
 */
export function getSelectionOffsets(root: HTMLElement): SelectionRangeOffsets | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  // 起止点必须落在文本节点中
  if (!isTextNode(range.startContainer) || !isTextNode(range.endContainer)) return null;

  const startBase = offsetBefore(root, range.startContainer);
  const endBase = offsetBefore(root, range.endContainer);
  if (startBase < 0 || endBase < 0) return null;

  const start = startBase + range.startOffset;
  const end = endBase + range.endOffset;
  if (end <= start) return null;

  const fullText = root.textContent ?? '';
  if (start < 0 || end > fullText.length) return null;
  return { start, end, text: fullText.slice(start, end) };
}

export function clearSelection() {
  window.getSelection()?.removeAllRanges();
}
