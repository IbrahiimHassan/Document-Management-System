export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-md bg-page px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}