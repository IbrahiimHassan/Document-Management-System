# Document Management System


A document repository where employees upload, version, search and preview company documents. Each document is visible either to everyone or only to chosen departments.

## Features

- **Uploads and versions:** upload PDF, Word (DOCX) and Excel (XLSX) files up to 10 MB, then add new versions. The full history is kept, and an identical re-upload is refused.
- **Department access:** each document is public or limited to chosen departments. Hidden documents answer `404`, so they can't be found by guessing ids.
- **Search:** search by title and by the words inside files, then filter by tags and uploader. Matching text from inside the file is highlighted in the results.
- **Previews:** every file opens in a new tab. PDFs show as they are, Word files show as a page and Excel files show as a table.
- **Virus scanning:** ClamAV scans every upload before it is stored, including files packed inside DOCX and XLSX zips.
- **Edit, delete and restore:** the uploader or an admin can change a document's details and who can see it, or delete it. Deleted documents stay restorable from the admin *Deleted* page.
- **Activity log:** views, previews, downloads, edits, deletes and restores are recorded, and the uploader and admins see them in the *Activity* panel.
- **Helpful warnings:** the upload page warns about duplicates and shows how many people will be able to see the file. A document page says when a newer version exists than the one you downloaded.
- **API docs:** interactive Swagger UI at `/api/docs`.

## Assumptions

- **Accounts:** users and departments are created by the seed (Finance, Legal, HR). Sign-up and user management were out of scope for the POC.
- **Roles:**
  - Admins can see and manage every document.
  - Only the uploader or an admin can add versions, edit or delete a document.
  - Managers are stored as a role but currently have the same rights as employees.
- **Access:** a document is either public or limited to one or more departments. The uploader can always see their own documents. Tags are free labels and don't control access.
- **Versions:** "a new version replaces the old one" means only the current version can be downloaded or previewed. Older versions stay listed in the history with their details and checksum.
- **Files:** only PDF, DOCX and XLSX files are accepted, up to 10 MB each. They are checked by their contents, not their extension, and stored in a local folder or Docker volume.
- **Deleting:** deletes are soft. A deleted document disappears for everyone but can be restored by an admin.

## Tech stack

| Part | Built with |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | Express 5, TypeScript, Zod |
| Data | PostgreSQL 17 (data and full-text search), Redis 8 (search cache) |
| Files | Local volume, ClamAV virus scanner |
| Tests | Vitest and Supertest (315 tests), GitHub Actions |

## Run everything with Docker

You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose --profile app up -d --build
```

Then open **http://localhost:3000**.

- **The first start takes a few minutes.** ClamAV downloads its virus signatures (about 300 MB) and needs about 1.5 GB of memory. You can browse and search right away, but uploads say "try again in a minute" until the scanner is ready.
- **Demo data is added automatically:** four users and six documents.
- **To stop:** `docker compose --profile app down`. Add `-v` to also delete the data.

### Demo accounts

All demo accounts use the password `password123`.

| Email | Role | Department |
|---|---|---|
| admin@example.com | Admin (sees everything) | Finance |
| finance@example.com | Manager | Finance |
| legal@example.com | Employee | Legal |
| hr@example.com | Employee | HR |

Sign in as different users to see the access rules. For example, the Q3 budget is visible to Finance but not to HR.

## Local development

Built and tested with Node.js 22 (22.15). You also need Docker for PostgreSQL and Redis.

```bash
# 1. Start PostgreSQL and Redis
docker compose up -d

# 2. Backend (http://localhost:3001)
cd backend
cp .env.example .env        # then set JWT_SECRET to a random string of 32+ characters
npm install
npm run migrate
npm run seed
npm run dev

# 3. Frontend (http://localhost:3000), in a second terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Virus scanning is off in local development unless you set `CLAMAV_HOST` in `backend/.env`.

## Tests

The tests use their own database, `document_repository_test`. Create it once:

```bash
docker compose exec db createdb -U document_user document_repository_test
```

Then run them:

```bash
cd backend
npm run migrate:test
npm test
```

GitHub Actions runs the backend tests, the frontend lint and the frontend build on every push and pull request.

### Try the virus scanner

With the Docker app running, upload a clean file and a harmless test "virus" (EICAR) through the API:

```bash
cd backend
npm run demo:virus
```

The clean file is accepted (`201`) and the infected one is refused (`422`).

## Project structure

```
backend/
  migrations/      SQL migrations
  src/
    routes/        URL to controller wiring
    controllers/   HTTP in and out, input validation
    services/      business and access rules
    repositories/  SQL queries
    files/         virus scan, text extraction, previews
    storage/       file storage on disk
    docs/          OpenAPI spec and Swagger UI
  tests/           Vitest and Supertest
frontend/
  app/             pages (login, search, upload, document, deleted)
  components/      UI components
  lib/             API client, types, helpers
docs/
  architecture.md  design choices, database schema, security, scaling
```

## What I'd do next with more time

- **Object storage:** move files to S3 or Azure Blob, with pre-signed download links. Only the storage module would change.
- **Background processing:** scan and extract text in a background worker queue, so large uploads don't wait inside the request.
- **Company sign-in:** single sign-on (for example Microsoft Entra ID), with departments and roles taken from the directory, plus an admin screen for users.
- **Manager rights:** give managers real powers, such as managing every document in their own department.
- **Better search:** rank results by relevance, and use OCR so scanned PDFs can be found by their contents.
- **Browser tests:** run end-to-end tests with Playwright in CI.
- **Shared rate limiting:** keep login rate-limit counts in Redis, so they survive restarts and work across several API instances.

## More detail

[docs/architecture.md](docs/architecture.md) covers the architecture, database schema, design decisions, security, testing, scaling path and known limitations.
