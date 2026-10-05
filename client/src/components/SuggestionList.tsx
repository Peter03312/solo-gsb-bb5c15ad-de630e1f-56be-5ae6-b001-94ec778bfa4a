import type { Adoption, Suggestion } from '../types';

interface Props {
  suggestions: Suggestion[];
  adoptions: Adoption[];
  activeId: number | null;
  canAdopt: boolean;
  busyId: number | null;
  onAdopt: (s: Suggestion) => void;
  onLocate: (s: Suggestion) => void;
}

const STATUS_TEXT: Record<Suggestion['status'], string> = {
  pending: '待审',
  adopted: '已采纳',
  conflict: '冲突',
};

export function SuggestionList({
  suggestions,
  adoptions,
  activeId,
  canAdopt,
  busyId,
  onAdopt,
  onLocate,
}: Props) {
  const adoptionBySuggestion = new Map(adoptions.map((a) => [a.suggestionId, a]));

  if (suggestions.length === 0) {
    return <p className="muted">该展签暂无校核建议。</p>;
  }

  return (
    <ul className="suggestion-list">
      {suggestions.map((s) => {
        const adoption = adoptionBySuggestion.get(s.id);
        return (
          <li
            key={s.id}
            id={`suggestion-${s.id}`}
            className={`suggestion-card status-${s.status}${activeId === s.id ? ' active' : ''}`}
          >
            <div className="suggestion-head">
              <span className={`badge badge-${s.status}`}>#{s.id} {STATUS_TEXT[s.status]}</span>
              <span className="muted">
                {s.creatorName} · 基于正文 v{s.createdVersion} · {s.createdAt.replace('T', ' ').slice(0, 16)}
              </span>
            </div>
            <div className="change-row">
              <div className="change-cell">
                <div className="change-label">原文字（选区 {s.startOffset}–{s.endOffset}）</div>
                <div className="quote old">{s.selectedText || <em className="muted">（空）</em>}</div>
              </div>
              <div className="change-arrow">→</div>
              <div className="change-cell">
                <div className="change-label">替换为</div>
                <div className="quote new">{s.replacement ? s.replacement : <em className="muted">（删除）</em>}</div>
              </div>
            </div>
            <div className="reason-line">
              <strong>依据：</strong>
              {s.reason}
            </div>

            {s.status === 'adopted' && (
              <div className="meta-line ok">
                已由 {s.adoptedByName ?? '馆员'} 采纳
                {adoption && `（正文 v${adoption.fromVersion} → v${adoption.toVersion}）`}
                {s.adoptedAt ? `，时间 ${s.adoptedAt.replace('T', ' ').slice(0, 16)}` : ''}。不可重复采纳。
              </div>
            )}
            {s.status === 'conflict' && (
              <div className="meta-line warn">
                已与建议 #{s.conflictedById} 的采纳选区重叠，自动转为冲突并停止采纳
                {s.conflictedAt ? `（${s.conflictedAt.replace('T', ' ').slice(0, 16)}）` : ''}。
              </div>
            )}

            <div className="suggestion-actions">
              {s.status === 'pending' && (
                <button className="btn btn-link" onClick={() => onLocate(s)}>
                  在正文中定位
                </button>
              )}
              {canAdopt && s.status === 'pending' && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busyId === s.id}
                  onClick={() => onAdopt(s)}
                >
                  {busyId === s.id ? '采纳中…' : '采纳该建议'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
