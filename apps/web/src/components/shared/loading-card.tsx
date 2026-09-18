import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'

// Placeholder for a page section still waiting on its query. Same shape as
// the section it stands in for: heading, description, then the content.
export function LoadingCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs/relaxed text-muted-foreground">{description}</p>
      </div>
      <TableLoadingSkeleton />
    </section>
  )
}
