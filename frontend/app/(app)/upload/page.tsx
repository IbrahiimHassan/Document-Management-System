import { UploadForm } from "@/components/UploadForm";

// Same opt-out as the other pages behind the login: they render on the client
// after the session check, so there is no static shell to validate
export const instant = false;

export default function UploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Upload document</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Add a new document to the repository.</p>
      <UploadForm />
    </div>
  );
}
