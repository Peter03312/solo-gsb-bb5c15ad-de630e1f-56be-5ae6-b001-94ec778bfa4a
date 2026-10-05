export type Role = 'reviewer' | 'librarian';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface LabelSummary {
  id: number;
  title: string;
  body: string;
  bodyVersion: number;
  createdAt: string;
  updatedAt: string;
  pendingCount: number;
  adoptedCount: number;
  conflictCount: number;
  lastPublicationVersion: number | null;
}

export type SuggestionStatus = 'pending' | 'adopted' | 'conflict';

export interface Suggestion {
  id: number;
  labelId: number;
  creatorId: number;
  creatorName: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  replacement: string;
  reason: string;
  status: SuggestionStatus;
  createdVersion: number;
  createdAt: string;
  adoptedAt: string | null;
  adoptedByName: string | null;
  conflictedById: number | null;
  conflictedAt: string | null;
}

export interface Adoption {
  id: number;
  labelId: number;
  suggestionId: number;
  adopterId: number;
  adopterName: string;
  fromVersion: number;
  toVersion: number;
  startOffset: number;
  endOffset: number;
  oldText: string;
  newText: string;
  appliedAt: string;
}

export interface Publication {
  id: number;
  labelId: number;
  version: number;
  bodyVersion: number;
  note: string;
  publisherId: number;
  publisherName: string;
  publishedAt: string;
  adoptionCount: number;
  bodySnapshot?: string;
  adoptions?: Adoption[];
}

export interface ApiError {
  status: number;
  message: string;
}
