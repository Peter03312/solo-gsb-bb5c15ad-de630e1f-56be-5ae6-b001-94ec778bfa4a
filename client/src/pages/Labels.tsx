import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import type { LabelSummary } from '../types';

export function LabelsPage() {
  const { user } = useAuth();
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { labels } = await api.listLabels();
      setLabels(labels);
      setError(null);
    } catch (err) {
      setError((err as { message: string }).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container">
      <div className="page-head">
        <h1>展签列表</h1>
        {user?.role === 'librarian' && (
          <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? '取消新建' : '新建展签'}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {showCreate && user?.role === 'librarian' && (
        <CreateLabelForm
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : labels.length === 0 ? (
        <p className="muted">暂无展签。</p>
      ) : (
        <div className="label-grid">
          {labels.map((l) => (
            <Link key={l.id} to={`/labels/${l.id}`} className="card label-card">
              <h2>{l.title}</h2>
              <p className="label-preview">{l.body.slice(0, 60)}…</p>
              <div className="label-meta">
                <span>正文 v{l.bodyVersion}</span>
                <span className="count pending">待审 {l.pendingCount}</span>
                <span className="count adopted">已采纳 {l.adoptedCount}</span>
                <span className="count conflict">冲突 {l.conflictCount}</span>
                {l.lastPublicationVersion !== null && (
                  <span className="count">已发布 {l.lastPublicationVersion} 次</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateLabelForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError('标题和正文均不能为空。');
      return;
    }
    setSaving(true);
    try {
      await api.createLabel(title.trim(), body);
      setTitle('');
      setBody('');
      onCreated();
    } catch (err) {
      setError((err as { message: string }).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>新建展签</h2>
      <label>
        标题
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label>
        正文
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      <button className="btn btn-primary" disabled={saving}>
        {saving ? '创建中…' : '创建（自动生成第 1 次发布）'}
      </button>
    </form>
  );
}
