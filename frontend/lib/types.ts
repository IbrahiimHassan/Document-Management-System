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
}

export interface DocumentDetail extends DocumentSummary {
  allowedDepartments: { id: string; name: string }[];
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