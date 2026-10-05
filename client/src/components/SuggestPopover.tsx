import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface SelectionInfo {
  start: number;
  end: number;
  text: string;
  x: number;
  y: number;
}

interface Props {
  selection: SelectionInfo;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (replacement: string, reason: string) => Promise<void>;
}

export function SuggestPopover({ selection, busy, onCancel, onSubmit }: Props) {
  const [replacement, setReplacement] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReplacement('');
    setReason('');
    setError(null);
  }, [selection.start, selection.end]);

  // 防止弹出位置超出视口底部
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(selection.x, window.innerWidth - 380),
    top: Math.min(selection.y, window.innerHeight - 320),
    width: 360,
    zIndex: 50,
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('请填写校核依据。');
      return;
    }
    setError(null);
    try {
      await onSubmit(replacement, reason.trim());
    } catch (err) {
      setError((err as { message: string }).message);
    }
  }

  return (
    <div className="popover" ref={ref} style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="popover-title">提交校核建议 #{selection.start}-{selection.end}</div>
      <div className="selected-quote" title={selection.text}>
        {selection.text.length > 80 ? `${selection.text.slice(0, 80)}…` : selection.text}
      </div>
      <form className="form" onSubmit={submit}>
        <label>
          替换文本（留空表示删除所选文字）
          <textarea
            rows={2}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            maxLength={5000}
          />
        </label>
        <label>
          校核依据
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={2000}
            placeholder="例如：据《XX图录》第…页，器型定名应为…；或：原稿错别字"
          />
        </label>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="popover-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '提交中…' : '提交建议'}
          </button>
        </div>
      </form>
    </div>
  );
}
