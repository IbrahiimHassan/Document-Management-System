import { formatDateTime, formatSize } from "@/lib/format";
import type { VersionRecord } from "@/lib/types";

interface VersionTableProps {
  versions: VersionRecord[];
}

const head = "whitespace-nowrap px-3 py-3 align-middle";
const cell = "whitespace-nowrap px-3 py-3 align-middle";

export function VersionTable({ versions }: VersionTableProps) {
  const currentNumber = versions[0]?.versionNumber;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th scope="col" className={`${head} text-center`}>Version</th>
            <th scope="col" className={`${head} text-left`}>File name</th>
            <th scope="col" className={`${head} text-center`}>Uploaded by</th>
            <th scope="col" className={`${head} text-center`}>Size</th>
            <th scope="col" className={`${head} text-center`}>Date</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id} className="border-b border-line last:border-0">
              <td className={`${cell} text-center`}>
                <span className="font-semibold">v{version.versionNumber}</span>
                {version.versionNumber === currentNumber && (
                  <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                    Current
                  </span>
                )}
              </td>
              <td className={`${cell} max-w-44 truncate text-left`} title={version.originalName}>
                {version.originalName}
              </td>
              <td className={`${cell} text-center text-muted`}>{version.uploadedByName}</td>
              <td className={`${cell} text-center text-muted`}>{formatSize(version.sizeBytes)}</td>
              <td className={`${cell} text-center text-muted`}>{formatDateTime(version.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}