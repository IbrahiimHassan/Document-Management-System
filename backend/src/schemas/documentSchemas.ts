import { z } from "zod";

// "Finance, Legal, finance" -> ["finance", "legal"] 
const tagList = z
  .string()
  .optional()
  .transform((value) =>
    [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ],
  )
  .pipe(
    z
      .array(z.string().max(30, "Each tag must be at most 30 characters"))
      .max(10, "At most 10 tags"),
  );


const departmentIdList = z
  .string()
  .optional()
  .transform((value) =>
    [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ],
  )
  .pipe(z.array(z.string().uuid("Each department id must be a valid UUID")));

export const createDocumentSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
    description: z
      .string()
      .trim()
      .max(2000, "Description is too long")
      .optional()
      .transform((value) => (value ? value : null)),
    visibility: z.enum(["public", "restricted"]).default("public"),
    tags: tagList,
    departmentIds: departmentIdList,
  })
  .refine(
    (data) => data.visibility === "public" || data.departmentIds.length > 0,
    { message: "A restricted document needs at least one department", path: ["departmentIds"] },
  );

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const documentIdSchema = z.string().uuid("Invalid document id");

export const listDocumentsQuerySchema = z.object({
  q: z.string().trim().max(200, "Search text is too long").optional(),
  tags: z
    .string()
    .optional()
    .transform((value) => [
      ...new Set(
        (value ?? "")
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0),
      ),
    ])
    .pipe(z.array(z.string().max(30)).max(10, "At most 10 tags")),
  uploader: z.string().trim().max(200, "Uploader filter is too long").optional(),
  page: z.coerce.number().int("page must be a whole number").min(1, "page must be at least 1").default(1),
  limit: z.coerce.number().int("limit must be a whole number").min(1, "limit must be at least 1").max(50, "limit must be at most 50").default(10),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// Edits arrive as JSON, so tags and departments are real arrays here
const normalizedTags = z
  .array(z.string("Each tag must be text"), "tags must be a list")
  .transform((tags) => [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)),
  ])
  .pipe(
    z
      .array(z.string().max(30, "Each tag must be at most 30 characters"))
      .max(10, "At most 10 tags"),
  );

// Every field is optional: only the ones sent are changed.
// Unknown fields are rejected, so a typo doesn't silently do nothing.
export const updateDocumentSchema = z
  .object({
    title: z.string("title must be text").trim().min(1, "Title is required").max(200, "Title is too long").optional(),
    description: z
      .string("description must be text or null")
      .trim()
      .max(2000, "Description is too long")
      .nullable()
      .optional()
      .transform((value) => (value === undefined ? undefined : value ? value : null)),
    tags: normalizedTags.optional(),
    visibility: z.enum(["public", "restricted"], "visibility must be public or restricted").optional(),
    departmentIds: z
      .array(z.string().uuid("Each department id must be a valid UUID"), "departmentIds must be a list")
      .transform((ids) => [...new Set(ids)])
      .optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Send at least one field to change",
  });

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const duplicateQuerySchema = z.object({
  checksum: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/, "checksum must be a SHA-256 hex string (64 characters)"),
});

export const audienceQuerySchema = z.object({
  visibility: z.enum(["public", "restricted"]).default("public"),
  departmentIds: departmentIdList,
});
