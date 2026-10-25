import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { pool } from "../config/database.js";
import * as cache from "../cache/cache.js";
import * as searchCache from "../cache/searchCache.js";
import * as documentRepository from "../repositories/documentRepository.js";
import * as fileStorage from "../storage/fileStorage.js";
import { extractText } from "../files/textExtraction.js";
import { makeDocx, makePdf, makeXlsx } from "../files/sampleFiles.js";

const DEMO_PASSWORD = "password123";

const departments = ["Finance", "Legal", "HR"];

const users = [
  { name: "Admin User", email: "admin@example.com", role: "admin", department: "Finance" },
  { name: "Finance Manager", email: "finance@example.com", role: "manager", department: "Finance" },
  { name: "Legal Employee", email: "legal@example.com", role: "employee", department: "Legal" },
  { name: "HR Employee", email: "hr@example.com", role: "employee", department: "HR" },
];

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface DemoFile {
  name: string;
  mimeType: string;
  bytes: () => Buffer;
}

interface DemoDocument {
  title: string;
  description: string;
  uploader: string;
  visibility: "public" | "restricted";
  departments: string[];
  tags: string[];
  // Oldest first; the last one is the current version
  versions: DemoFile[];
}

// Who sees what (the permission demo):
//   HR Employee     -> Handbook, Security Policy, Salary Review
//   Finance Manager -> Handbook, Security Policy, Budget, Audit Findings
//   Legal Employee  -> Handbook, Security Policy, Vendor Contract, Audit Findings
//   Admin           -> everything
// Words worth searching for (they're only inside the files): reimbursement,
// phishing, reconciliation, indemnification, overtime.
const demoDocuments: DemoDocument[] = [
  {
    title: "Employee Handbook 2026",
    description: "Working hours, leave, benefits and the code of conduct for all staff.",
    uploader: "admin@example.com",
    visibility: "public",
    departments: [],
    tags: ["hr", "policy", "onboarding"],
    versions: [
      {
        name: "employee-handbook-2026.pdf",
        mimeType: PDF,
        bytes: () =>
          makePdf("Employee Handbook 2026 (draft)", [
            "This draft describes working hours, annual leave and the code of conduct.",
            "Overtime must be approved in advance by your line manager.",
          ]),
      },
      {
        name: "employee-handbook-2026.pdf",
        mimeType: PDF,
        bytes: () =>
          makePdf("Employee Handbook 2026", [
            "Welcome to the company. This handbook applies to every employee in every department.",
            "Working hours are 9:00 to 17:00, Sunday to Thursday. Overtime must be approved in advance by your line manager and is paid at 1.5 times the hourly rate.",
            "Annual leave: 21 working days per year, rising to 30 days after ten years of service. Requests go through the HR portal at least two weeks ahead.",
            "Travel reimbursement: keep every receipt and submit the expense form within 30 days of your trip.",
            "Code of conduct: treat colleagues with respect, protect confidential information, and report any conflict of interest to HR.",
          ]),
      },
    ],
  },
  {
    title: "Office Security Policy",
    description: "Badges, visitors, passwords and how to report a suspicious email.",
    uploader: "hr@example.com",
    visibility: "public",
    departments: [],
    tags: ["security", "policy"],
    versions: [
      {
        name: "office-security-policy.pdf",
        mimeType: PDF,
        bytes: () =>
          makePdf("Office Security Policy", [
            "Always wear your badge inside the building. Visitors must be signed in at reception and escorted at all times.",
            "Passwords must be at least 12 characters long and must never be shared, not even with IT staff.",
            "Phishing: if an email asks for your password or urges you to open an unexpected attachment, do not click anything. Forward it to security@example.com and delete it.",
            "Lock your screen whenever you leave your desk.",
          ]),
      },
    ],
  },
  {
    title: "Q3 2026 Budget Forecast",
    description: "Department budgets and spending forecast for the third quarter.",
    uploader: "finance@example.com",
    visibility: "restricted",
    departments: ["Finance"],
    tags: ["finance", "budget", "forecast"],
    versions: [
      {
        name: "q3-2026-budget-forecast.xlsx",
        mimeType: XLSX,
        bytes: () =>
          makeXlsx("Q3 Forecast", [
            ["Department", "Budget (EGP)", "Forecast (EGP)", "Notes"],
            ["Finance", 1200000, 1150000, "Audit fees moved to Q4"],
            ["Legal", 800000, 845000, "External counsel for the vendor dispute"],
            ["HR", 650000, 640000, "Recruitment campaign postponed"],
            ["Total", 2650000, 2635000, "Capital expenditure excluded"],
          ]),
      },
    ],
  },
  {
    title: "Acme Supplies Vendor Contract",
    description: "Master services agreement with Acme Supplies, signed March 2026.",
    uploader: "legal@example.com",
    visibility: "restricted",
    departments: ["Legal"],
    tags: ["legal", "contract", "vendor"],
    versions: [
      {
        name: "acme-vendor-contract.docx",
        mimeType: DOCX,
        bytes: () =>
          makeDocx([
            "Master Services Agreement: Acme Supplies",
            "1. Scope. Acme Supplies will deliver office equipment and consumables as listed in Schedule A.",
            "2. Term. The agreement runs for 24 months from 1 March 2026 and renews automatically unless either party gives 60 days' notice.",
            "3. Payment. Invoices are payable within 45 days of receipt.",
            "4. Indemnification. Acme Supplies shall indemnify the company against third-party claims arising from defective goods.",
            "5. Confidentiality. Both parties keep the terms of this agreement confidential.",
          ]),
      },
    ],
  },
  {
    title: "Annual Audit Findings",
    description: "Internal audit results shared between Finance and Legal.",
    uploader: "finance@example.com",
    visibility: "restricted",
    departments: ["Finance", "Legal"],
    tags: ["audit", "finance", "legal"],
    versions: [
      {
        name: "annual-audit-findings.pdf",
        mimeType: PDF,
        bytes: () =>
          makePdf("Annual Audit Findings", [
            "Finding 1: The monthly bank reconciliation was completed late in four of twelve months. Recommendation: assign a backup owner.",
            "Finding 2: Two vendor contracts were renewed without a legal review. Recommendation: route all renewals through Legal.",
            "Finding 3: Access to the payment system was not removed for one employee who left in May.",
            "Management has agreed to resolve all findings by the end of Q4.",
          ]),
      },
    ],
  },
  {
    title: "Salary Review Guidelines",
    description: "How the yearly salary review works. HR only.",
    uploader: "hr@example.com",
    visibility: "restricted",
    departments: ["HR"],
    tags: ["hr", "salary", "confidential"],
    versions: [
      {
        name: "salary-review-guidelines.pdf",
        mimeType: PDF,
        bytes: () =>
          makePdf("Salary Review Guidelines", [
            "The yearly salary review takes place in January. Managers submit proposals by 15 December.",
            "Increases are based on performance ratings and the market benchmark for each role.",
            "All proposals are confidential and must not be discussed outside the HR team.",
          ]),
      },
    ],
  },
];

async function seedUsers(): Promise<void> {
  for (const name of departments) {
    await pool.query(
      "INSERT INTO departments (name) VALUES ($1) ON CONFLICT DO NOTHING",
      [name],
    );
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const user of users) {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       SELECT $1, $2, $3, $4, id FROM departments WHERE lower(name) = lower($5)
       ON CONFLICT (email) DO NOTHING`,
      [user.name, user.email, passwordHash, user.role, user.department],
    );
    console.log(`${result.rowCount ? "created" : "exists "}  ${user.email}`);
  }
}

async function idOf(sql: string, value: string): Promise<string> {
  const result = await pool.query<{ id: string }>(sql, [value]);
  if (!result.rows[0]) throw new Error(`Seed data missing: ${value}`);
  return result.rows[0].id;
}

// Stores one version the same way an upload does: file on disk, checksum,
// extracted text. Demo files are built by this script, so they aren't virus-scanned.
async function storeVersion(file: DemoFile, uploadedBy: string): Promise<documentRepository.NewVersionData> {
  const bytes = file.bytes();
  const extension = file.name.split(".").pop()!;
  return {
    storageKey: await fileStorage.saveFile(bytes, extension),
    originalName: file.name,
    mimeType: file.mimeType,
    sizeBytes: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    uploadedBy,
    contentText: await extractText(bytes, file.mimeType),
  };
}

async function seedDocuments(): Promise<void> {
  for (const demo of demoDocuments) {
    const uploaderId = await idOf("SELECT id FROM users WHERE email = $1", demo.uploader);

    // Runs on every Docker start: skip documents created before, even deleted ones,
    // so a demo document an admin deleted doesn't come back
    const existing = await pool.query(
      "SELECT 1 FROM documents WHERE title = $1 AND uploader_id = $2",
      [demo.title, uploaderId],
    );
    if (existing.rowCount) {
      console.log(`exists   ${demo.title}`);
      continue;
    }

    const departmentIds: string[] = [];
    for (const name of demo.departments) {
      departmentIds.push(await idOf("SELECT id FROM departments WHERE lower(name) = lower($1)", name));
    }

    const [first, ...later] = demo.versions;
    const created = await documentRepository.createDocumentWithFirstVersion({
      title: demo.title,
      description: demo.description,
      visibility: demo.visibility,
      uploaderId,
      tags: demo.tags,
      departmentIds,
      version: await storeVersion(first!, uploaderId),
    });
    for (const file of later) {
      await documentRepository.addVersion(created.documentId, await storeVersion(file, uploaderId));
    }
    console.log(`created  ${demo.title} (${demo.versions.length} version${demo.versions.length > 1 ? "s" : ""})`);
  }
}

async function seed(): Promise<void> {
  await seedUsers();
  await seedDocuments();
  // Rows were written directly, so drop any cached searches that predate them
  await cache.ready();
  await searchCache.invalidateAll();
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    await cache.close();
  });
