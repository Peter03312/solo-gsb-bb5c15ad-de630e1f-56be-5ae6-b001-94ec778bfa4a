import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return (
      <div className="container narrow">
        <div className="card">
          <p>已登录为「{user.displayName}」（{user.role === 'librarian' ? '馆员' : '校核人'}）。</p>
          <Link className="btn btn-primary" to="/labels">
            进入展签列表
          </Link>
        </div>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u = await login(username.trim(), password);
      navigate('/labels', { replace: true });
      void u;
    } catch (err) {
      setError((err as { message: string }).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container narrow">
      <div className="card login-card">
        <h1>展签校核系统</h1>
        <p className="muted">展览展签文字校核与馆员审批发布平台</p>
        <form onSubmit={onSubmit} className="form">
          <label>
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>
        <div className="demo-hint">
          <p className="muted">演示账号：</p>
          <ul>
            <li>校核人：<code>reviewer / reviewer123</code></li>
            <li>馆员：<code>librarian / librarian123</code></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
