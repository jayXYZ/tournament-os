import { Skeleton } from '@/components/ui/skeleton'

export function SettingsSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
      <Skeleton className="h-40" />
    </div>
  )
}
