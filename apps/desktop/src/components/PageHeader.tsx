/**
 * Title of a screen that has no repository context (Settings,
 * Repositories). Repository work happens on the thread, which needs no
 * title: the seal names the repository.
 */
export function PageHeader({ title, visible = false }: { title: string; visible?: boolean }) {
  return visible ? (
    <div className="shrink-0 px-8 pt-8 pb-2">
      <h1 className="text-xl font-medium text-fg">{title}</h1>
    </div>
  ) : (
    <h1 className="sr-only">{title}</h1>
  );
}
