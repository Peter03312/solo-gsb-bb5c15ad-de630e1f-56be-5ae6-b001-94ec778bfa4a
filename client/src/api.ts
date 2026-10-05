import type {
  Adoption,
  LabelSummary,
  Publication,
  Suggestion,
  User,
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...init,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${res.status}）。`;
    throw { status: res.status, message } as { status: number; message: string };
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  listLabels: () => request<{ labels: LabelSummary[] }>('/api/labels'),
  createLabel: (title: string, body: string) =>
    request<{ label: LabelSummary }>('/api/labels', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    }),

  listSuggestions: (labelId: number) =>
    request<{ suggestions: Suggestion[] }>(`/api/labels/${labelId}/suggestions`),
  createSuggestion: (
    labelId: number,
    payload: { startOffset: number; endOffset: number; replacement: string; reason: string },
  ) =>
    request<{ suggestion: Suggestion }>(`/api/labels/${labelId}/suggestions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adopt: (suggestionId: number, expectedVersion: number) =>
    request<{ ok: boolean; labelId: number; bodyVersion: number; conflictedSuggestionIds: number[] }>(
      `/api/suggestions/${suggestionId}/adopt`,
      { method: 'POST', body: JSON.stringify({ expectedVersion }) },
    ),

  listAdoptions: (labelId: number) =>
    request<{ adoptions: Adoption[] }>(`/api/labels/${labelId}/adoptions`),

  listPublications: (labelId: number) =>
    request<{ publications: Publication[] }>(`/api/labels/${labelId}/publications`),
  getPublication: (publicationId: number) =>
    request<{ publication: Publication }>(`/api/publications/${publicationId}`),
  publish: (labelId: number, expectedVersion: number, note: string) =>
    request<{ publication: Publication }>(`/api/labels/${labelId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ expectedVersion, note }),
    }),
};
