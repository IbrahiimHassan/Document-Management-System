import { DocumentDetailView } from "@/components/DocumentDetailView";

// Same opt-out as the other pages behind the login
export const instant = false;

export default function DocumentPage() {
  return <DocumentDetailView />;
}