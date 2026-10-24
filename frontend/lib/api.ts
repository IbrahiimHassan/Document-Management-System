import type {
  CreatedVersion,
  DocumentDetail,
  DocumentList,
  ListParams,
  User,
  VersionRecord,
  Department,
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

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection and try again.");
  }

  if (response.status === 401 && redirectOn401 && typeof window !== "undefined") {
    window.location.assign("/login");
  }

  if (!response.ok) {
    let code = "UNKNOWN_ERROR";
    let message = "Something went wrong. Please try again.";
    try {
      const data = await response.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
    } catch {
      // The body was not JSON: keep the generic message
    }
    throw new ApiError(response.status, code, message);
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

// A plain link: the browser sends the cookie and downloads the file itself
export function downloadUrl(id: string, version?: number): string {
  const base = `/api/documents/${encodeURIComponent(id)}/download`;
  return version ? `${base}?version=${version}` : base;
}

export async function listDepartments(): Promise<Department[]> {
  const data = await request<{ items: Department[] }>("/departments");
  return data.items;
}