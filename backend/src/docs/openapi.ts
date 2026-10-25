// The API description shown at /api/docs. Written by hand so every endpoint
// documents the exact status codes the code really returns; a test checks that
// every route in the app is listed here.

const json = (schema: object) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function error(description: string) {
  return { description, content: json(ref("Error")) };
}

const errors = {
  400: error("Invalid input (bad id, query or body)"),
  401: error("Not logged in"),
  403: error("Visible, but you may not do this"),
  404: error("Unknown, deleted, or hidden from you (the same answer for all three)"),
};

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "Document id",
};

const uploadForm = (withMetadata: boolean) => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: withMetadata ? ["file", "title"] : ["file"],
        properties: {
          file: { type: "string", format: "binary", description: "PDF, DOCX or XLSX, up to 10 MB. The type is checked from the bytes, not the name." },
          ...(withMetadata
            ? {
                title: { type: "string", maxLength: 200 },
                description: { type: "string", maxLength: 2000 },
                tags: { type: "string", example: "finance, policy", description: "Comma-separated, at most 10" },
                visibility: { type: "string", enum: ["public", "restricted"], default: "public" },
                departmentIds: { type: "string", description: "Comma-separated department ids. Required when restricted." },
              }
            : {}),
        },
      },
    },
  },
});

const uploadErrors = {
  413: error("File larger than the limit"),
  415: error("Not a real PDF, DOCX or XLSX"),
  422: error("The virus scanner found malware; nothing was stored"),
  503: error("The virus scanner is configured but unreachable; nothing was stored"),
};

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Document Repository API",
    version: "1.0.0",
    description:
      "Upload, version, search and download corporate documents, with access limited by department.\n\n" +
      "**Trying it here:** call `POST /api/auth/login` first (for example `admin@example.com` / `password123`). " +
      "The session cookie is then sent with every other request on this page.\n\n" +
      "**Access rule:** a user can see a document if they are an admin, they uploaded it, it is public, " +
      "or their department is in its list. Only the uploader or an admin can change it. " +
      "Documents you can't see answer `404`, exactly like ids that don't exist.\n\n" +
      "Every error has the shape `{ \"error\": { \"code\", \"message\" } }`.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Auth" },
    { name: "Documents", description: "Search, details, edit, delete" },
    { name: "Versions and files", description: "Upload, download, preview, integrity" },
    { name: "Upload helpers", description: "Used by the upload form before sending a file" },
    { name: "Activity", description: "Audit log and deleted documents" },
    { name: "System" },
  ],
  components: {
    securitySchemes: {
      session: { type: "apiKey", in: "cookie", name: "token", description: "Set by POST /api/auth/login (httpOnly, 1 hour)" },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: { code: { type: "string", example: "NOT_FOUND" }, message: { type: "string" } },
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          email: { type: "string" },
          role: { type: "string", enum: ["admin", "manager", "employee"] },
          departmentId: { type: "string", format: "uuid" },
          departmentName: { type: "string" },
        },
      },
      SnippetPart: {
        type: "object",
        properties: { text: { type: "string" }, match: { type: "boolean", description: "true for the words that matched" } },
      },
      DocumentSummary: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          visibility: { type: "string", enum: ["public", "restricted"] },
          uploaderId: { type: "string", format: "uuid" },
          uploaderName: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          currentVersion: { type: "integer" },
          originalName: { type: "string" },
          mimeType: { type: "string" },
          sizeBytes: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          snippet: {
            type: ["array", "null"],
            items: ref("SnippetPart"),
            description: "Where the search words were found inside the file. null when they weren't.",
          },
          lastDownloadedVersion: {
            type: ["integer", "null"],
            description: "The highest version you downloaded. Lower than currentVersion means the file changed since.",
          },
        },
      },
      DocumentDetail: {
        allOf: [
          ref("DocumentSummary"),
          {
            type: "object",
            properties: {
              allowedDepartments: {
                type: "array",
                items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
              },
              hasSearchableText: { type: "boolean", description: "Whether text could be read from the current file" },
            },
          },
        ],
      },
      DocumentPage: {
        type: "object",
        properties: {
          items: { type: "array", items: ref("DocumentSummary") },
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
      Version: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          versionNumber: { type: "integer" },
          originalName: { type: "string" },
          mimeType: { type: "string" },
          sizeBytes: { type: "integer" },
          checksumSha256: { type: "string" },
          uploadedById: { type: "string", format: "uuid" },
          uploadedByName: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CreatedVersion: {
        type: "object",
        properties: {
          documentId: { type: "string", format: "uuid" },
          versionId: { type: "string", format: "uuid" },
          versionNumber: { type: "integer" },
        },
      },
      DocumentUpdate: {
        type: "object",
        additionalProperties: false,
        description: "Send only the fields to change. A restricted document needs at least one department.",
        properties: {
          title: { type: "string", maxLength: 200 },
          description: { type: ["string", "null"], maxLength: 2000 },
          tags: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 10 },
          visibility: { type: "string", enum: ["public", "restricted"] },
          departmentIds: { type: "array", items: { type: "string", format: "uuid" } },
        },
        example: { title: "Q3 Budget (final)", tags: ["finance", "budget"], visibility: "restricted" },
      },
      AuditEvent: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          action: { type: "string", enum: ["view", "preview", "download", "edit", "delete", "restore"] },
          versionNumber: { type: ["integer", "null"] },
          details: { type: ["object", "null"], properties: { changes: { type: "array", items: { type: "string" } } } },
          userId: { type: "string", format: "uuid" },
          userName: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Integrity: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["intact", "problem"] },
          checkedAt: { type: "string", format: "date-time" },
          versions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                versionNumber: { type: "integer" },
                status: { type: "string", enum: ["intact", "modified", "missing"] },
                expected: { type: "string", description: "SHA-256 saved at upload" },
                actual: { type: ["string", "null"], description: "SHA-256 of the file on disk now" },
              },
            },
          },
        },
      },
    },
  },
  security: [{ session: [] }],
  paths: {
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in",
        security: [],
        description: "Sets the session cookie. After 10 failed attempts for one email from one IP in 15 minutes, answers 429.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["email", "password"],
            properties: { email: { type: "string", example: "admin@example.com" }, password: { type: "string", example: "password123" } },
          }),
        },
        responses: {
          200: { description: "Logged in", content: json({ type: "object", properties: { user: ref("User") } }) },
          400: errors[400],
          401: error("Wrong email or password (the same message for both)"),
          429: error("Too many failed attempts"),
        },
      },
    },
    "/api/auth/logout": {
      post: { tags: ["Auth"], summary: "Log out", security: [], responses: { 204: { description: "Cookie cleared" } } },
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "The logged-in user",
        responses: { 200: { description: "OK", content: json({ type: "object", properties: { user: ref("User") } }) }, 401: errors[401] },
      },
    },
    "/api/departments": {
      get: {
        tags: ["Upload helpers"],
        summary: "All departments",
        responses: {
          200: {
            description: "OK",
            content: json({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } } }),
          },
          401: errors[401],
        },
      },
    },
    "/api/documents": {
      get: {
        tags: ["Documents"],
        summary: "Search documents you can see",
        description:
          "`q` matches part of the title, or whole words (and word beginnings) inside the current version's file. " +
          "Results are newest-updated first. Documents you can't see never appear, not even in `total`.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 200 }, description: "Title or file contents" },
          { name: "tags", in: "query", schema: { type: "string" }, description: "Comma-separated; a document must have all of them" },
          { name: "uploader", in: "query", schema: { type: "string" }, description: "Part of the uploader's name" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
        ],
        responses: { 200: { description: "One page of results", content: json(ref("DocumentPage")) }, 400: errors[400], 401: errors[401] },
      },
      post: {
        tags: ["Versions and files"],
        summary: "Upload a new document (version 1)",
        description: "The file is scanned for malware (when ClamAV is configured) and its text is extracted for search.",
        requestBody: uploadForm(true),
        responses: { 201: { description: "Created", content: json(ref("CreatedVersion")) }, 400: errors[400], 401: errors[401], ...uploadErrors },
      },
    },
    "/api/documents/duplicates": {
      get: {
        tags: ["Upload helpers"],
        summary: "Is this exact file already here?",
        description: "Documents you can see whose current file has this SHA-256. Hidden documents are never mentioned.",
        parameters: [{ name: "checksum", in: "query", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } }],
        responses: {
          200: {
            description: "Matches (at most 5)",
            content: json({ type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, versionNumber: { type: "integer" } } } } } }),
          },
          400: errors[400],
          401: errors[401],
        },
      },
    },
    "/api/documents/audience": {
      get: {
        tags: ["Upload helpers"],
        summary: "How many people could open a document with these settings",
        description: "Public: everyone. Restricted: admins, you (the uploader), and members of the chosen departments.",
        parameters: [
          { name: "visibility", in: "query", schema: { type: "string", enum: ["public", "restricted"], default: "public" } },
          { name: "departmentIds", in: "query", schema: { type: "string" }, description: "Comma-separated" },
        ],
        responses: {
          200: { description: "OK", content: json({ type: "object", properties: { userCount: { type: "integer" } } }) },
          400: errors[400],
          401: errors[401],
        },
      },
    },
    "/api/documents/deleted": {
      get: {
        tags: ["Activity"],
        summary: "Deleted documents (admin only)",
        responses: {
          200: {
            description: "Newest deletion first",
            content: json({
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" },
                      uploaderName: { type: "string" },
                      currentVersion: { type: "integer" },
                      deletedAt: { type: "string", format: "date-time" },
                      deletedByName: { type: "string" },
                    },
                  },
                },
              },
            }),
          },
          401: errors[401],
          403: error("Not an admin"),
        },
      },
    },
    "/api/documents/{id}": {
      parameters: [idParam],
      get: {
        tags: ["Documents"],
        summary: "Document details (records a view)",
        responses: { 200: { description: "OK", content: json(ref("DocumentDetail")) }, 400: errors[400], 401: errors[401], 404: errors[404] },
      },
      patch: {
        tags: ["Documents"],
        summary: "Edit title, description, tags or permissions (uploader or admin)",
        requestBody: { required: true, content: json(ref("DocumentUpdate")) },
        responses: { 200: { description: "The updated document", content: json(ref("DocumentDetail")) }, ...errors },
      },
      delete: {
        tags: ["Documents"],
        summary: "Delete (uploader or admin)",
        description: "A soft delete: the document answers 404 for everyone, but its versions, files and audit trail are kept and an admin can restore it.",
        responses: { 204: { description: "Deleted" }, ...errors },
      },
    },
    "/api/documents/{id}/restore": {
      parameters: [idParam],
      post: {
        tags: ["Activity"],
        summary: "Restore a deleted document (admin only)",
        responses: { 200: { description: "Restored", content: json(ref("DocumentDetail")) }, 400: errors[400], 401: errors[401], 403: error("Not an admin"), 404: error("No deleted document with this id") },
      },
    },
    "/api/documents/{id}/versions": {
      parameters: [idParam],
      get: {
        tags: ["Versions and files"],
        summary: "Version history, newest first",
        responses: {
          200: { description: "OK", content: json({ type: "object", properties: { items: { type: "array", items: ref("Version") } } }) },
          400: errors[400],
          401: errors[401],
          404: errors[404],
        },
      },
      post: {
        tags: ["Versions and files"],
        summary: "Upload a new version (uploader or admin)",
        description: "The new file becomes the current version; older ones stay in the history.",
        requestBody: uploadForm(false),
        responses: {
          201: { description: "Created", content: json(ref("CreatedVersion")) },
          ...errors,
          409: error("The file is identical to the current version"),
          ...uploadErrors,
        },
      },
    },
    "/api/documents/{id}/download": {
      parameters: [idParam],
      get: {
        tags: ["Versions and files"],
        summary: "Download the current version (records a download)",
        parameters: [{ name: "version", in: "query", schema: { type: "integer", minimum: 1 }, description: "Optional. Only the current number is allowed." }],
        responses: {
          200: { description: "The file, as an attachment", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          400: errors[400],
          401: errors[401],
          403: error("An older version was requested; only the current one can be downloaded"),
          404: error("Unknown, hidden, or the file is missing on disk"),
        },
      },
    },
    "/api/documents/{id}/preview": {
      parameters: [idParam],
      get: {
        tags: ["Versions and files"],
        summary: "The current version, ready to show in a browser tab (records a preview)",
        description:
          "PDFs are sent as they are. Word and Excel files are turned into a read-only web page " +
          "(text, tables and images; spreadsheets as tables). Both are sent inline with a strict " +
          "Content-Security-Policy, so nothing in the file can run.",
        responses: {
          200: {
            description: "The PDF, or a web page made from the Word or Excel file",
            content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "text/html": { schema: { type: "string" } },
            },
          },
          400: errors[400],
          401: errors[401],
          404: errors[404],
          422: error("The file couldn't be read (damaged, or unpacks to more than the preview allows)"),
        },
      },
    },
    "/api/documents/{id}/integrity": {
      parameters: [idParam],
      get: {
        tags: ["Versions and files"],
        summary: "Check every stored version against its upload checksum",
        responses: { 200: { description: "OK", content: json(ref("Integrity")) }, 400: errors[400], 401: errors[401], 404: errors[404] },
      },
    },
    "/api/documents/{id}/audit": {
      parameters: [idParam],
      get: {
        tags: ["Activity"],
        summary: "Who viewed, downloaded or changed this document (uploader or admin)",
        responses: {
          200: { description: "The latest 100 events", content: json({ type: "object", properties: { items: { type: "array", items: ref("AuditEvent") } } }) },
          ...errors,
        },
      },
    },
    "/api/health": {
      get: {
        tags: ["System"],
        summary: "Health of the API and its services",
        security: [],
        responses: {
          200: {
            description: "Database reachable",
            content: json({
              type: "object",
              properties: {
                status: { type: "string" },
                database: { type: "string" },
                cache: { type: "string", enum: ["connected", "unavailable", "disabled"] },
                virusScanner: { type: "string", enum: ["connected", "unavailable", "disabled"] },
              },
            }),
          },
          503: { description: "Database unreachable" },
        },
      },
    },
  },
};
