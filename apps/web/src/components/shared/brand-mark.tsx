import { cn } from '@/lib/utils'

// The Paper Pairings mark: a folded-corner sheet holding a bracket. Two brand
// variants exist — an outline for light surfaces and a knockout sheet for dark
// ones. Both draw in currentColor so they follow the surrounding text color.
type BrandMarkVariant = 'auto' | 'outline' | 'knockout'

export function BrandMark({
  variant = 'auto',
  className,
}: {
  // `auto` renders both variants and lets the `.dark` class pick; pass an
  // explicit variant only on surfaces whose darkness ignores the theme (e.g.
  // a fixed-color hero or print layout).
  variant?: BrandMarkVariant
  className?: string
}) {
  if (variant === 'outline') return <OutlineMark className={className} />
  if (variant === 'knockout') return <KnockoutMark className={className} />
  return (
    <>
      <OutlineMark className={cn('dark:hidden', className)} />
      <KnockoutMark className={cn('hidden dark:block', className)} />
    </>
  )
}

function OutlineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 480"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M70 44C70 30.7452 80.7452 20 94 20H280.059C286.424 20 292.529 22.5286 297.029 27.0294L402.971 132.971C407.471 137.471 410 143.576 410 149.941V436C410 449.255 399.255 460 386 460H94C80.7452 460 70 449.255 70 436V44Z"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M290 20V116C290 129.255 300.745 140 314 140H410"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinejoin="round"
      />
      <path
        d="M134 190H216C229.255 190 240 200.745 240 214V326C240 339.255 229.255 350 216 350H134"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M240 270H346"
        stroke="currentColor"
        strokeWidth="32"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function KnockoutMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 480"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M274 116C274 138.091 291.909 156 314 156H410V436C410 449.255 399.255 460 386 460H94C80.7452 460 70 449.255 70 436V44C70 30.7452 80.7452 20 94 20H274V116ZM134 174C125.163 174 118 181.163 118 190C118 198.837 125.163 206 134 206H216C220.418 206 224 209.582 224 214V326C224 330.418 220.418 334 216 334H134C125.163 334 118 341.163 118 350C118 358.837 125.163 366 134 366H216C238.091 366 256 348.091 256 326V286H346C354.837 286 362 278.837 362 270C362 261.163 354.837 254 346 254H256V214C256 191.909 238.091 174 216 174H134ZM394 124H314C309.582 124 306 120.418 306 116V36L394 124Z"
        fill="currentColor"
      />
    </svg>
  )
}
