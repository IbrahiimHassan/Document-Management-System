import { UploadForm } from "@/components/UploadForm";

export default function UploadPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Upload document</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Add a new document to the repository.</p>
      <UploadForm />
    </div>
  );
}