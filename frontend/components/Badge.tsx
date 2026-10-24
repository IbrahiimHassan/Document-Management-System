const styles = {
  public: "bg-brand-soft text-brand",
  restricted: "bg-warn-soft text-warn",
} as const;

export function Badge({ visibility }: { visibility: "public" | "restricted" }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[visibility]}`}
    >
      {visibility === "public" ? "Public" : "Restricted"}
    </span>
  );
}