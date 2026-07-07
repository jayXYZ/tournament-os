import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

// Shared typography for organizer-authored markdown so the admin editor and
// the public tournament page render identically. Sizing is left to callers;
// `max-w-none` because line length is the parent layout's concern.
export const markdownProseClasses =
  'prose prose-sm prose-neutral dark:prose-invert max-w-none'

export function MarkdownContent({
  markdown,
  className,
}: {
  markdown: string
  className?: string
}) {
  return (
    <div className={cn(markdownProseClasses, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  )
}
