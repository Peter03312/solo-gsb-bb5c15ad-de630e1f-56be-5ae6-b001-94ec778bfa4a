import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import type { Role } from './types';
import { LoginPage } from './pages/Login';
import { LabelsPage } from './pages/Labels';
import { LabelDetailPage } from './pages/LabelDetail';
import type { ReactNode } from 'react';

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container"><p className="muted">加载中…</p></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return (
      <div className="container">
        <div className="card error-card">
          <strong>无权限访问该页面。</strong>
          <p className="muted">
            当前账号「{user.displayName}」是{user.role === 'librarian' ? '馆员' : '校核人'}，此页面仅限
            {roles.map((r) => (r === 'librarian' ? '馆员' : '校核人')).join('或')}使用。
          </p>
          <Link className="btn" to="/labels">
            返回展签列表
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/labels" className="brand">
          展签校核
        </Link>
        <nav className="topnav">
          <Link to="/labels">展签列表</Link>
        </nav>
        <div className="topuser">
          <span className="role-badge" data-role={user.role}>
            {user.role === 'librarian' ? '馆员' : '校核人'}
          </span>
          <span>{user.displayName}</span>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}

export function App() {
  const { loading } = useAuth();
  return (
    <>
      <Header />
      {loading ? (
        <div className="container">
          <p className="muted">加载中…</p>
        </div>
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/labels"
            element={
              <RoleGate roles={['reviewer', 'librarian']}>
                <LabelsPage />
              </RoleGate>
            }
          />
          <Route
            path="/labels/:id"
            element={
              <RoleGate roles={['reviewer', 'librarian']}>
                <LabelDetailPage />
              </RoleGate>
            }
          />
          <Route path="*" element={<Navigate to="/labels" replace />} />
        </Routes>
      )}
    </>
  );
}
