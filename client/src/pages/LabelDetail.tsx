import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Adoption, LabelSummary, Publication, Suggestion } from '../types';
import { HighlightedBody, SelectableBody } from '../components/LabelBody';
import { SuggestPopover, type SelectionInfo } from '../components/SuggestPopover';
import { SuggestionList } from '../components/SuggestionList';
import { AdoptionsTimeline } from '../components/AdoptionsTimeline';
import { PublicationsPanel } from '../components/PublicationsPanel';
import { clearSelection, getSelectionOffsets } from '../selection';

type Tab = 'suggestions' | 'adoptions' | 'publications';
type Filter = 'all' | Suggestion['status'];

interface DetailData {
  label: LabelSummary;
  suggestions: Suggestion[];
  adoptions: Adoption[];
  publications: Publication[];
}

export function LabelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const labelId = Number(id);
  const { user } = useAuth();
  const isLibrarian = user?.role === 'librarian';

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('suggestions');
  const [filter, setFilter] = useState<Filter>('all');
  const [activeSuggestionId, setActiveSuggestionId] = useState<number | null>(null);
  const [busyAdoptId, setBusyAdoptId] = useState<number | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [pubReloadToken, setPubReloadToken] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(labelId) || labelId < 1) {
      setPageError('展签不存在。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [l, s, a, p] = await Promise.all([
        fetch(`/api/labels/${labelId}`).then((r) => r.json()),
        api.listSuggestions(labelId),
        api.listAdoptions(labelId),
        api.listPublications(labelId),
      ]);
      if (l && !l.label) throw new Error(l.error || '展签不存在。');
      setData({ label: l.label, suggestions: s.suggestions, adoptions: a.adoptions, publications: p.publications });
      setPageError(null);
    } catch (err) {
      setPageError((err as { message: string }).message);
    } finally {
      setLoading(false);
    }
  }, [labelId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function onBodyMouseUp() {
    if (isLibrarian || !bodyRef.current) return;
    const info = getSelectionOffsets(bodyRef.current);
    if (!info) {
      setSelection(null);
      return;
    }
    const rect = bodyRef.current.getBoundingClientRect();
    const sel = window.getSelection();
    let x = rect.left + 16;
    let y = rect.bottom + 8;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      x = Math.max(8, r.left);
      y = r.bottom + 8;
    }
    setSelection({ start: info.start, end: info.end, text: info.text, x, y });
  }

  async function submitSuggestion(replacement: string, reason: string) {
    if (!selection) return;
    await api.createSuggestion(labelId, {
      startOffset: selection.start,
      endOffset: selection.end,
      replacement,
      reason,
    });
    setSelection(null);
    clearSelection();
    setToast('校核建议已提交，等待馆员审批。');
    await load();
  }

  async function adopt(s: Suggestion) {
    if (!data) return;
    if (
      !window.confirm(
        `确认采纳建议 #${s.id}？\n\n将把「${s.selectedText}」替换为「${s.replacement || '（删除）'}」。\n` +
          `与其选区重叠的其它待审建议将转为冲突。此操作只改动该选区，不能撤销。`,
      )
    )
      return;
    setBusyAdoptId(s.id);
    setPageError(null);
    try {
      const result = await api.adopt(s.id, data.label.bodyVersion);
      setToast(
        `已采纳建议 #${s.id}，正文更新为 v${result.bodyVersion}。` +
          (result.conflictedSuggestionIds.length
            ? ` 有 ${result.conflictedSuggestionIds.length} 条重叠建议转为冲突。`
            : ''),
      );
      await load();
    } catch (err) {
      setPageError((err as { message: string }).message);
      await load(); // 409/并发冲突时刷新到最新状态
    } finally {
      setBusyAdoptId(null);
    }
  }

  function locate(s: Suggestion) {
    setActiveSuggestionId(s.id);
    setTimeout(() => {
      bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }

  async function doPublish() {
    if (!data) return;
    setPublishing(true);
    setPageError(null);
    try {
      const { publication } = await api.publish(labelId, data.label.bodyVersion, publishNote);
      setPublishOpen(false);
      setPublishNote('');
      setTab('publications');
      setPubReloadToken((t) => t + 1);
      setToast(`已发布第 ${publication.version} 次，正文 v${publication.bodyVersion} 已固化。`);
      await load();
    } catch (err) {
      setPageError((err as { message: string }).message);
      await load();
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <p className="muted">加载中…</p>
      </div>
    );
  }
  if (pageError && !data) {
    return (
      <div className="container">
        <div className="alert alert-error">{pageError}</div>
        <Link className="btn" to="/labels">
          返回列表
        </Link>
      </div>
    );
  }
  if (!data) return null;

  const { label, suggestions, adoptions, publications } = data;
  const pending = suggestions.filter((s) => s.status === 'pending');
  const filtered = filter === 'all' ? suggestions : suggestions.filter((s) => s.status === filter);

  return (
    <div className="container">
      <div className="breadcrumb">
        <Link to="/labels">展签列表</Link> <span>/</span> {label.title}
      </div>

      <div className="page-head">
        <div>
          <h1>{label.title}</h1>
          <div className="label-version-line">
            <span className="badge badge-version">当前正文 v{label.bodyVersion}</span>
            {label.lastPublicationVersion !== null && (
              <span className="muted">已发布 {label.lastPublicationVersion} 次</span>
            )}
            <span className="muted">最近更新 {label.updatedAt.replace('T', ' ').slice(0, 16)}</span>
          </div>
        </div>
        {isLibrarian && (
          <button className="btn btn-primary" onClick={() => setPublishOpen((v) => !v)}>
            {publishOpen ? '取消发布' : '发布当前正文'}
          </button>
        )}
      </div>

      {pageError && (
        <div className="alert alert-error" role="alert">
          {pageError}
        </div>
      )}
      {toast && (
        <div className="alert alert-ok" role="status">
          {toast}
        </div>
      )}

      {publishOpen && isLibrarian && (
        <div className="card publish-form">
          <h2>发布确认</h2>
          <p className="muted">
            发布将固化当前正文（v{label.bodyVersion}）的不可变快照，并记录自上次发布以来的全部采纳。
            发布后任何编辑都不会改写旧发布。
          </p>
          <label>
            发布备注（可选）
            <input value={publishNote} onChange={(e) => setPublishNote(e.target.value)} maxLength={500} />
          </label>
          <div className="row-actions">
            <button className="btn btn-ghost" onClick={() => setPublishOpen(false)} disabled={publishing}>
              取消
            </button>
            <button className="btn btn-primary" onClick={doPublish} disabled={publishing}>
              {publishing ? '发布中…' : `确认发布（依据 v${label.bodyVersion}）`}
            </button>
          </div>
        </div>
      )}

      <section className="card body-card">
        <div className="body-card-head">
          <h2>展签正文</h2>
          {!isLibrarian ? (
            <span className="muted">用鼠标选中连续文字即可提交替换建议（选区必须在本段正文内）。</span>
          ) : (
            <span className="muted">
              <mark className="pending-mark static">高亮</mark> 为待审建议选区；点击高亮或「采纳该建议」审批。
            </span>
          )}
        </div>
        {isLibrarian ? (
          <HighlightedBody
            body={label.body}
            pending={pending}
            activeId={activeSuggestionId}
            onSelectMark={(mid) => {
              setActiveSuggestionId(mid);
              setTab('suggestions');
              const el = document.getElementById(`suggestion-${mid}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          />
        ) : (
          <SelectableBody ref={bodyRef} body={label.body} onMouseUp={onBodyMouseUp} />
        )}
      </section>

      <div className="tabs">
        <button className={tab === 'suggestions' ? 'active' : ''} onClick={() => setTab('suggestions')}>
          建议（{suggestions.length}）
        </button>
        <button className={tab === 'adoptions' ? 'active' : ''} onClick={() => setTab('adoptions')}>
          采纳记录（{adoptions.length}）
        </button>
        <button className={tab === 'publications' ? 'active' : ''} onClick={() => setTab('publications')}>
          发布与差异（{publications.length}）
        </button>
      </div>

      <section className="card tab-panel">
        {tab === 'suggestions' && (
          <>
            <div className="filter-bar">
              {(['all', 'pending', 'adopted', 'conflict'] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={`chip${filter === f ? ' active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all'
                    ? `全部 ${suggestions.length}`
                    : f === 'pending'
                      ? `待审 ${label.pendingCount}`
                      : f === 'adopted'
                        ? `已采纳 ${label.adoptedCount}`
                        : `冲突 ${label.conflictCount}`}
                </button>
              ))}
            </div>
            <SuggestionList
              suggestions={filtered}
              adoptions={adoptions}
              activeId={activeSuggestionId}
              canAdopt={!!isLibrarian}
              busyId={busyAdoptId}
              onAdopt={adopt}
              onLocate={(s) => {
                setActiveSuggestionId(s.id);
                document.getElementById(`suggestion-${s.id}`)?.scrollIntoView({ block: 'center' });
              }}
            />
          </>
        )}
        {tab === 'adoptions' && <AdoptionsTimeline adoptions={adoptions} />}
        {tab === 'publications' && (
          <PublicationsPanel labelId={labelId} publications={publications} reloadToken={pubReloadToken} />
        )}
      </section>

      {selection && !isLibrarian && (
        <>
          <div className="popover-backdrop" onClick={() => setSelection(null)} />
          <SuggestPopover
            selection={selection}
            busy={false}
            onCancel={() => {
              setSelection(null);
              clearSelection();
            }}
            onSubmit={submitSuggestion}
          />
        </>
      )}
    </div>
  );
}
