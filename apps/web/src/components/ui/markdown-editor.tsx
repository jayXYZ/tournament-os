import { useEffect, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  TextQuote,
  Undo2,
} from 'lucide-react'

import type { Editor } from '@tiptap/react'
import type { FormEvent } from 'react'
import { markdownProseClasses } from '@/components/shared/markdown-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// WYSIWYG editor whose value in and out is a markdown string, so the stored
// content stays portable and renders anywhere (see markdown-content.tsx).
// Underline is disabled because markdown has no syntax for it, and headings
// are capped at h2/h3 so authored sections sit below the page title.
export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  placeholder,
  className,
}: {
  /** Initial markdown; the editor owns the text after mount. */
  value: string
  onChange: (markdown: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        link: { openOnClick: false },
      }),
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
    ],
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    // The page shell is server-rendered; defer editor creation to the client
    // to avoid hydration mismatches.
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      onChange(current.getMarkdown())
    },
    editorProps: {
      attributes: {
        class: cn(markdownProseClasses, 'min-h-40 px-3 py-2 outline-none'),
      },
    },
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-input/20 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <MarkdownEditorToolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  )
}

function MarkdownEditorToolbar({
  editor,
  disabled,
}: {
  editor: Editor | null
  disabled: boolean
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            strike: current.isActive('strike'),
            h2: current.isActive('heading', { level: 2 }),
            h3: current.isActive('heading', { level: 3 }),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            blockquote: current.isActive('blockquote'),
            link: current.isActive('link'),
            canUndo: current.can().undo(),
            canRedo: current.can().redo(),
          }
        : null,
  })

  const groups: Array<
    Array<{
      key: string
      label: string
      icon: typeof Bold
      active?: boolean
      disabled?: boolean
      run: (current: Editor) => void
    }>
  > = [
    [
      {
        key: 'bold',
        label: 'Bold',
        icon: Bold,
        active: state?.bold,
        run: (current) => current.chain().focus().toggleBold().run(),
      },
      {
        key: 'italic',
        label: 'Italic',
        icon: Italic,
        active: state?.italic,
        run: (current) => current.chain().focus().toggleItalic().run(),
      },
      {
        key: 'strike',
        label: 'Strikethrough',
        icon: Strikethrough,
        active: state?.strike,
        run: (current) => current.chain().focus().toggleStrike().run(),
      },
    ],
    [
      {
        key: 'h2',
        label: 'Heading',
        icon: Heading2,
        active: state?.h2,
        run: (current) =>
          current.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        key: 'h3',
        label: 'Subheading',
        icon: Heading3,
        active: state?.h3,
        run: (current) =>
          current.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    ],
    [
      {
        key: 'bulletList',
        label: 'Bullet list',
        icon: List,
        active: state?.bulletList,
        run: (current) => current.chain().focus().toggleBulletList().run(),
      },
      {
        key: 'orderedList',
        label: 'Numbered list',
        icon: ListOrdered,
        active: state?.orderedList,
        run: (current) => current.chain().focus().toggleOrderedList().run(),
      },
      {
        key: 'blockquote',
        label: 'Quote',
        icon: TextQuote,
        active: state?.blockquote,
        run: (current) => current.chain().focus().toggleBlockquote().run(),
      },
    ],
    [
      {
        key: 'undo',
        label: 'Undo',
        icon: Undo2,
        disabled: !state?.canUndo,
        run: (current) => current.chain().focus().undo().run(),
      },
      {
        key: 'redo',
        label: 'Redo',
        icon: Redo2,
        disabled: !state?.canRedo,
        run: (current) => current.chain().focus().redo().run(),
      },
    ],
  ]

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-1 py-1">
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex items-center gap-0.5">
          {groupIndex > 0 ? (
            <div aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          ) : null}
          {group.map(({ key, label, icon: Icon, active, run, ...item }) => (
            <ToolbarButton
              key={key}
              label={label}
              active={active ?? false}
              disabled={disabled || !editor || item.disabled}
              onClick={() => {
                if (editor) {
                  run(editor)
                }
              }}
            >
              <Icon />
            </ToolbarButton>
          ))}
          {groupIndex === 2 ? (
            <LinkPopoverButton
              editor={editor}
              active={state?.link ?? false}
              disabled={disabled || !editor}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(active && 'bg-muted text-foreground')}
      // Keep the editor selection instead of moving focus to the button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function LinkPopoverButton({
  editor,
  active,
  disabled,
}: {
  editor: Editor | null
  active: boolean
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && editor) {
      setUrl((editor.getAttributes('link').href as string | undefined) ?? '')
    }
    setOpen(nextOpen)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor) {
      return
    }
    const trimmed = url.trim()
    if (trimmed.length === 0) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Link"
          title="Link"
          aria-pressed={active}
          disabled={disabled}
          className={cn(active && 'bg-muted text-foreground')}
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {/* Rendered in a portal, so this form never nests inside the page's
            settings form. */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Input
            autoFocus
            placeholder="example.com/details"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label="Link URL"
          />
          <Button type="submit" size="sm">
            {url.trim().length === 0 && active ? 'Remove' : 'Apply'}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}
