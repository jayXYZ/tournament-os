import { Skeleton } from '@/components/ui/skeleton'

export function SettingsSkeleton() {
  return (
    <div className="grid gap-8">
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
      <Skeleton className="h-32" />
    </div>
  )
}
