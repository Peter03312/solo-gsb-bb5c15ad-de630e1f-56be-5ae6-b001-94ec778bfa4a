import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { diffText, type DiffPart } from '../diff';
import type { Adoption, Publication } from '../types';

function DiffView({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="diff-view">
      {parts.map((p, i) => {
        if (p.op === 'equal') return <span key={i}>{p.text}</span>;
        if (p.op === 'delete')
          return (
            <del key={i} className="diff-del">
              {p.text}
            </del>
          );
        return (
          <ins key={i} className="diff-ins">
            {p.text}
          </ins>
        );
      })}
    </div>
  );
}

function AdoptionList({ adoptions }: { adoptions: Adoption[] }) {
  if (adoptions.length === 0)
    return <p className="muted">本次发布与上次发布之间没有采纳记录（正文未因采纳发生变化）。</p>;
  return (
    <ul className="adoption-list">
      {adoptions.map((a) => (
        <li key={a.id}>
          <span className="muted">建议 #{a.suggestionId} · {a.adopterName} · v{a.fromVersion}→v{a.toVersion}</span>
          <div className="change-row compact">
            <div className="quote old">{a.oldText || <em className="muted">（空）</em>}</div>
            <div className="change-arrow">→</div>
            <div className="quote new">{a.newText ? a.newText : <em className="muted">（删除）</em>}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PublicationsPanel({
  labelId,
  publications,
  reloadToken,
}: {
  labelId: number;
  publications: Publication[];
  reloadToken: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [compareWith, setCompareWith] = useState<number | null>(null);
  const [detail, setDetail] = useState<Publication | null>(null);
  const [baseDetail, setBaseDetail] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 默认选中最新一次发布
  useEffect(() => {
    if (publications.length > 0 && selected === null) setSelected(publications[0].id);
  }, [publications, selected]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (selected === null) {
        setDetail(null);
        setBaseDetail(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { publication } = await api.getPublication(selected);
        if (cancelled) return;
        setDetail(publication);
        if (compareWith !== null) {
          const { publication: base } = await api.getPublication(compareWith);
          if (!cancelled) setBaseDetail(base);
        } else {
          setBaseDetail(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as { message: string }).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selected, compareWith, reloadToken, labelId]);

  const diffParts = useMemo(() => {
    if (!detail?.bodySnapshot) return null;
    return diffText(baseDetail?.bodySnapshot ?? '', detail.bodySnapshot);
  }, [detail, baseDetail]);

  return (
    <div className="pub-panel">
      <div className="pub-layout">
        <div className="pub-list-col">
          <h3>发布历史</h3>
          {publications.length === 0 && <p className="muted">尚未发布。</p>}
          <ul className="pub-list">
            {publications.map((p) => (
              <li key={p.id}>
                <button
                  className={`pub-item${selected === p.id ? ' active' : ''}`}
                  onClick={() => setSelected(p.id)}
                >
                  <strong>第 {p.version} 次发布</strong>
                  <span className="muted">
                    正文 v{p.bodyVersion} · {p.publishedAt.replace('T', ' ').slice(0, 16)}
                  </span>
                  <span className="muted">{p.publisherName} · 含 {p.adoptionCount} 条采纳</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="pub-detail-col">
          {loading && <p className="muted">加载中…</p>}
          {error && <div className="alert alert-error">{error}</div>}
          {detail && (
            <>
              <div className="pub-detail-head">
                <h3>
                  第 {detail.version} 次发布（{detail.publishedAt.replace('T', ' ').slice(0, 16)}，
                  {detail.publisherName}）
                </h3>
                <label className="compare-control">
                  对比基准：
                  <select
                    value={compareWith ?? ''}
                    onChange={(e) => setCompareWith(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">不对比（仅显示该版全文）</option>
                    {publications
                      .filter((p) => p.id !== detail.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          第 {p.version} 次发布（正文 v{p.bodyVersion}）
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {detail.note && <p className="pub-note">备注：{detail.note}</p>}

              <h4>{compareWith !== null ? '正文差异' : '发布正文（固化快照，不可再改写）'}</h4>
              {compareWith !== null && (
                <p className="muted">
                  <del className="diff-del">删除</del> 为基准版内容，
                  <ins className="diff-ins">新增</ins> 为所选发布版内容。
                </p>
              )}
              {diffParts ? <DiffView parts={diffParts} /> : <p className="muted">无正文数据。</p>}

              <h4>本次发布固化的采纳记录</h4>
              <AdoptionList adoptions={detail.adoptions ?? []} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
