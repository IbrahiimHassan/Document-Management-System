import { Suspense } from "react";
import { DocumentsView } from "@/components/DocumentsView";
export const instant = false;

export default function DocumentsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Search and manage your documents.</p>
      <Suspense fallback={null}>
        <DocumentsView />
      </Suspense>
    </div>
  );
}