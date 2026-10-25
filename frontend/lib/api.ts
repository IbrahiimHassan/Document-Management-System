import type {
  AuditEvent,
  CreatedVersion,
  DeletedDocument,
  Department,
  DocumentDetail,
  DocumentList,
  DocumentUpdate,
  DuplicateMatch,
  ListParams,
  User,
  VersionRecord,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  redirectOn401?: boolean;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`/api${path}`, { ...init, credentials: "include" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }
}

function redirectIfExpired(response: Response, redirectOn401: boolean): void {
  if (response.status === 401 && redirectOn401 && typeof window !== "undefined") {
    // A full reload on purpose: it drops all client state of the expired session.
    // This helper is not a component, so useRouter() is not available here anyway.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}

// Turns an error response into an ApiError with the server's message
async function toApiError(response: Response): Promise<ApiError> {
  let code = "UNKNOWN_ERROR";
  let message = "Something went wrong. Please try again.";
  try {
    const data = await response.json();
    code = data?.error?.code ?? code;
    message = data?.error?.message ?? message;
  } catch {
    // The body was not JSON: keep the generic message
  }
  return new ApiError(response.status, code, message);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, form, redirectOn401 = true } = options;

  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    // Do not set Content-Type: the browser adds the multipart boundary itself
    body = form;
  }

  const response = await send(path, { method, headers, body });
  redirectIfExpired(response, redirectOn401);

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function login(email: string, password: string): Promise<{ user: User }> {
  // A 401 here means "wrong password", not "session expired", so no redirect
  return request("/auth/login", { method: "POST", json: { email, password }, redirectOn401: false });
}

export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST", redirectOn401: false });
}

export function getMe(): Promise<{ user: User }> {
  return request("/auth/me");
}

export function listDocuments(params: ListParams = {}): Promise<DocumentList> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.tags) query.set("tags", params.tags);
  if (params.uploader) query.set("uploader", params.uploader);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(`/documents${suffix}`);
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return request(`/documents/${encodeURIComponent(id)}`);
}

export async function getVersions(id: string): Promise<VersionRecord[]> {
  const data = await request<{ items: VersionRecord[] }>(
    `/documents/${encodeURIComponent(id)}/versions`,
  );
  return data.items;
}

export function createDocument(form: FormData): Promise<CreatedVersion> {
  return request("/documents", { method: "POST", form });
}

export function addVersion(id: string, form: FormData): Promise<CreatedVersion> {
  return request(`/documents/${encodeURIComponent(id)}/versions`, { method: "POST", form });
}

export function updateDocument(id: string, changes: DocumentUpdate): Promise<DocumentDetail> {
  return request(`/documents/${encodeURIComponent(id)}`, { method: "PATCH", json: changes });
}

export function deleteDocument(id: string): Promise<void> {
  return request(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listDeleted(): Promise<DeletedDocument[]> {
  const data = await request<{ items: DeletedDocument[] }>("/documents/deleted");
  return data.items;
}

export function restoreDocument(id: string): Promise<DocumentDetail> {
  return request(`/documents/${encodeURIComponent(id)}/restore`, { method: "POST" });
}

export async function getAuditLog(id: string): Promise<AuditEvent[]> {
  const data = await request<{ items: AuditEvent[] }>(`/documents/${encodeURIComponent(id)}/audit`);
  return data.items;
}

export async function findDuplicates(checksum: string): Promise<DuplicateMatch[]> {
  const data = await request<{ items: DuplicateMatch[] }>(
    `/documents/duplicates?checksum=${encodeURIComponent(checksum)}`,
  );
  return data.items;
}

export async function countAudience(
  visibility: "public" | "restricted",
  departmentIds: string[],
): Promise<number> {
  const query = new URLSearchParams({ visibility });
  if (departmentIds.length > 0) query.set("departmentIds", departmentIds.join(","));
  const data = await request<{ userCount: number }>(`/documents/audience?${query.toString()}`);
  return data.userCount;
}

// Files are fetched instead of opened with a plain link, so a failure (for
// example a file missing on disk) shows a message on the page, not raw JSON.
async function fetchFile(path: string): Promise<Blob> {
  const response = await send(path, { method: "GET" });
  redirectIfExpired(response, true);
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.blob();
}

// Only the current version can be downloaded, so there is no version option
export async function downloadDocument(id: string, fileName: string): Promise<void> {
  const blob = await fetchFile(`/documents/${encodeURIComponent(id)}/download`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing the memory
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// The current version as a blob: URL, opened in a new tab: the PDF itself, or a
// read-only page the server made from a Word or Excel file. The caller revokes it when done.
export async function previewUrl(id: string): Promise<string> {
  const blob = await fetchFile(`/documents/${encodeURIComponent(id)}/preview`);
  return URL.createObjectURL(blob);
}

export async function listDepartments(): Promise<Department[]> {
  const data = await request<{ items: Department[] }>("/departments");
  return data.items;
}