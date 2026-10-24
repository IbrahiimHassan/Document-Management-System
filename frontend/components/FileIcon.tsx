import { FileSpreadsheet, FileText } from "lucide-react";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function FileIcon({ mimeType }: { mimeType: string }) {
  let box = "bg-red-50 text-red-600";
  let Icon = FileText;

  if (mimeType === DOCX) {
    box = "bg-blue-50 text-blue-600";
  } else if (mimeType === XLSX) {
    box = "bg-emerald-50 text-emerald-600";
    Icon = FileSpreadsheet;
  }

  return (
    <span className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${box}`}>
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}