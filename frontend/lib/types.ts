export type Role = "admin" | "manager" | "employee";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  departmentName: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  description: string | null;
  visibility: "public" | "restricted";
  uploaderId: string;
  uploaderName: string;
  tags: string[];
  currentVersion: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  // Where the search words were found inside the file (null when they weren't)
  snippet: SnippetPart[] | null;
  // The highest version this user downloaded; lower than currentVersion means it changed since
  lastDownloadedVersion: number | null;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface DocumentDetail extends DocumentSummary {
  allowedDepartments: { id: string; name: string }[];
  hasSearchableText: boolean;
}

export interface DocumentUpdate {
  title?: string;
  description?: string | null;
  tags?: string[];
  visibility?: "public" | "restricted";
  departmentIds?: string[];
}

export type AuditAction = "view" | "preview" | "download" | "edit" | "delete" | "restore";

export interface AuditEvent {
  id: string;
  action: AuditAction;
  versionNumber: number | null;
  details: { changes?: string[] } | null;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  versionNumber: number;
}

export interface DeletedDocument {
  id: string;
  title: string;
  uploaderName: string;
  currentVersion: number;
  deletedAt: string;
  deletedByName: string;
}

export interface VersionRecord {
  id: string;
  versionNumber: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedById: string;
  uploadedByName: string;
  createdAt: string;
}

export interface DocumentList {
  items: DocumentSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreatedVersion {
  documentId: string;
  versionId: string;
  versionNumber: number;
}

export interface ListParams {
  q?: string;
  tags?: string;
  uploader?: string;
  page?: number;
  limit?: number;
}

export interface Department {
  id: string;
  name: string;
}