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