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