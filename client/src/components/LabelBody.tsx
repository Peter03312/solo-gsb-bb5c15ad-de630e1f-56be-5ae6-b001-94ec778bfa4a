import { forwardRef, useMemo, type MouseEvent } from 'react';
import type { Suggestion } from '../types';

interface Mark {
  start: number;
  end: number;
  status: Suggestion['status'];
  id: number;
}

/** 按字符打标：待审 > 其他（已采纳/冲突的冻结偏移不随后续编辑移动，故不在当前正文上标注） */
function buildCharMarks(bodyLen: number, pending: Suggestion[]): (Mark | null)[] {
  const marks: (Mark | null)[] = new Array(bodyLen).fill(null);
  for (const s of pending) {
    if (s.startOffset < 0 || s.endOffset > bodyLen || s.endOffset <= s.startOffset) continue;
    for (let i = s.startOffset; i < s.endOffset; i++) {
      if (!marks[i]) marks[i] = { start: s.startOffset, end: s.endOffset, status: 'pending', id: s.id };
    }
  }
  return marks;
}

interface PendingBodyProps {
  body: string;
  pending: Suggestion[];
  activeId?: number | null;
  onSelectMark?: (id: number) => void;
}

/** 馆员视图：高亮所有待审建议选区，点击高亮可定位到建议卡片 */
export function HighlightedBody({ body, pending, activeId, onSelectMark }: PendingBodyProps) {
  const marks = useMemo(() => buildCharMarks(body.length, pending), [body.length, pending]);
  const segments = useMemo(() => {
    const out: { text: string; markId: number | null; active: boolean }[] = [];
    let i = 0;
    while (i < body.length) {
      const m = marks[i];
      if (!m) {
        let j = i + 1;
        while (j < body.length && !marks[j]) j++;
        out.push({ text: body.slice(i, j), markId: null, active: false });
        i = j;
      } else {
        const end = m.end;
        out.push({ text: body.slice(i, end), markId: m.id, active: m.id === activeId });
        i = end;
      }
    }
    return out;
  }, [body, marks, activeId]);

  return (
    <div className="label-body highlighted-body">
      {segments.map((seg, idx) =>
        seg.markId === null ? (
          <span key={idx}>{seg.text}</span>
        ) : (
          <mark
            key={idx}
            className={`pending-mark${seg.active ? ' active' : ''}`}
            onClick={() => onSelectMark?.(seg.markId!)}
          >
            {seg.text}
          </mark>
        ),
      )}
    </div>
  );
}

interface PlainBodyProps {
  body: string;
  onMouseUp?: (e: MouseEvent<HTMLDivElement>) => void;
}

/** 校核人视图：可选正文，mouseup 后由父组件读取 Selection 偏移 */
export const SelectableBody = forwardRef<HTMLDivElement, PlainBodyProps>(function SelectableBody(
  { body, onMouseUp },
  ref,
) {
  return (
    <div className="label-body selectable-body" ref={ref} onMouseUp={onMouseUp}>
      {body}
    </div>
  );
});
