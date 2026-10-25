import { DeletedDocumentsView } from "@/components/DeletedDocumentsView";

// Same opt-out as the other pages behind the login
export const instant = false;

export default function DeletedDocumentsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Deleted documents</h1>
      <p className="mt-1 mb-6 text-sm text-muted">Hidden from everyone until restored.</p>
      <DeletedDocumentsView />
    </div>
  );
}
