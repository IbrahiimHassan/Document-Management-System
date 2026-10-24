import Link from "next/link";
import { FileX, Lock } from "lucide-react";

interface StatusScreenProps {
  kind: "not-found" | "forbidden";
}

const content = {
  "not-found": {
    Icon: FileX,
    title: "Document not found",
    message: "The document you are looking for doesn't exist or has been removed.",
  },
  forbidden: {
    Icon: Lock,
    title: "Access denied",
    message: "You don't have permission to view or change this document.",
  },
} as const;

export function StatusScreen({ kind }: StatusScreenProps) {
  const { Icon, title, message } = content[kind];

  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <span className="flex size-28 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-12" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{message}</p>
      <Link
        href="/"
        className="mt-6 inline-flex w-fit items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        Back to documents
      </Link>
    </div>
  );
}