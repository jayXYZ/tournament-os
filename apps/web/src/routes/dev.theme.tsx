import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  Building2Icon,
  CalendarIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TentIcon,
  Trash2Icon,
  TrophyIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import type { ComponentProps } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import {
  DataTable,
  DataTableColumnHeader,
  dateRangeFilter,
  oneOfFilter,
} from '@/components/ui/data-table'
import {
  DataTableToolbar,
  columnSearch,
} from '@/components/ui/data-table-toolbar'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { BrandMark } from '@/components/shared/brand-mark'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTheme } from '@/components/theme-provider'

/**
 * Dev-only swatch sheet for the Radix Themes restyle: every button variant
 * and size, in both themes, side by side. 404s outside `vite dev`.
 */
export const Route = createFileRoute('/dev/theme')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: ThemeSheet,
})

type Variant = NonNullable<ComponentProps<typeof Button>['variant']>
type Size = NonNullable<ComponentProps<typeof Button>['size']>

const variants: Array<Variant> = [
  'default',
  'brand',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
]
const sizes: Array<Size> = ['xs', 'sm', 'default', 'lg']
const iconSizes: Array<Size> = ['icon-xs', 'icon-sm', 'icon', 'icon-lg']

const grayScale = Array.from({ length: 12 }, (_, i) => i + 1)

const formats = ['Modern', 'Legacy', 'Pioneer', 'Standard', 'Commander']

type EventRow = {
  id: string
  name: string
  format: string
  status: 'live' | 'upcoming' | 'completed'
  players: number
  startsAt: number
}

const eventRows: Array<EventRow> = [
  {
    id: '1',
    name: 'Friday Night Modern',
    format: 'Modern',
    status: 'live',
    players: 32,
    startsAt: Date.UTC(2026, 8, 25, 23),
  },
  {
    id: '2',
    name: 'Legacy Showdown',
    format: 'Legacy',
    status: 'upcoming',
    players: 18,
    startsAt: Date.UTC(2026, 9, 2, 17),
  },
  {
    id: '3',
    name: 'Pioneer Open',
    format: 'Pioneer',
    status: 'upcoming',
    players: 64,
    startsAt: Date.UTC(2026, 9, 9, 16),
  },
  {
    id: '4',
    name: 'Commander Night',
    format: 'Commander',
    status: 'completed',
    players: 24,
    startsAt: Date.UTC(2026, 8, 18, 23),
  },
  {
    id: '5',
    name: 'Standard Showdown',
    format: 'Standard',
    status: 'completed',
    players: 12,
    startsAt: Date.UTC(2026, 8, 11, 23),
  },
]

const statusBadge: Record<
  EventRow['status'],
  ComponentProps<typeof Badge>['variant']
> = {
  live: 'brand',
  upcoming: 'secondary',
  completed: 'outline',
}

const eventColumns: Array<ColumnDef<EventRow>> = [
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Event" />
    ),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  { accessorKey: 'format', header: 'Format', filterFn: oneOfFilter },
  {
    accessorKey: 'status',
    header: 'Status',
    filterFn: oneOfFilter,
    cell: ({ row }) => (
      <Badge variant={statusBadge[row.original.status]}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: 'players',
    header: ({ column }) => (
      <DataTableColumnHeader
        column={column}
        title="Players"
        className="-mr-2 ml-auto"
      />
    ),
    meta: { className: 'text-right tabular-nums' },
  },
  {
    accessorKey: 'startsAt',
    header: 'Starts',
    filterFn: dateRangeFilter,
    cell: ({ row }) =>
      new Date(row.original.startsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
  },
]

/**
 * Menus and popovers portal to `document.body`, so they take the html-level
 * theme rather than the panel they were opened from. Interacting with a panel
 * flips the document theme to match, and each panel pins its own theme with
 * an explicit `.light` / `.dark` wrapper so it stays put while the other
 * side's portals render.
 */
function ThemeSheet() {
  const { setTheme } = useTheme()
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div
        className="light"
        onPointerDownCapture={() => setTheme('light')}
        onFocusCapture={() => setTheme('light')}
      >
        <Panel />
      </div>
      <div
        className="dark"
        onPointerDownCapture={() => setTheme('dark')}
        onFocusCapture={() => setTheme('dark')}
      >
        <Panel />
      </div>
    </div>
  )
}

function Panel() {
  return (
    <div className="bg-background text-foreground flex flex-col gap-8 bg-[radial-gradient(var(--gray-a5)_1px,transparent_1px)] bg-[size:20px_20px] p-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Gray
        </h2>
        <div className="flex gap-1">
          {grayScale.map((step) => (
            <div
              key={step}
              className="h-8 flex-1 rounded-(--radius-1)"
              style={{ background: `var(--gray-${step})` }}
            />
          ))}
        </div>
        <div className="flex gap-1">
          {grayScale.map((step) => (
            <div
              key={step}
              className="h-8 flex-1 rounded-(--radius-1)"
              style={{ background: `var(--gray-a${step})` }}
            />
          ))}
        </div>
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Iris
        </h2>
        <div className="flex gap-1">
          {grayScale.map((step) => (
            <div
              key={step}
              className="h-8 flex-1 rounded-(--radius-1)"
              style={{ background: `var(--iris-${step})` }}
            />
          ))}
        </div>
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Red
        </h2>
        <div className="flex gap-1">
          {grayScale.map((step) => (
            <div
              key={step}
              className="h-8 flex-1 rounded-(--radius-1)"
              style={{ background: `var(--red-${step})` }}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Variants × sizes
        </h2>
        {variants.map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground w-20 text-xs">
              {variant}
            </span>
            {sizes.map((size) => (
              <Button key={size} variant={variant} size={size}>
                Create event
              </Button>
            ))}
            <Button variant={variant}>
              <PlusIcon data-icon="inline-start" />
              With icon
            </Button>
            <Button variant={variant}>
              Next
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} aria-expanded>
              Open
            </Button>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Icon buttons
        </h2>
        {variants
          .filter((v) => v !== 'link')
          .map((variant) => (
            <div key={variant} className="flex items-center gap-3">
              <span className="text-muted-foreground w-20 text-xs">
                {variant}
              </span>
              {iconSizes.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  <Trash2Icon />
                </Button>
              ))}
            </div>
          ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Inputs
        </h2>
        <div className="grid max-w-2xl grid-cols-2 gap-3">
          <Input placeholder="Placeholder" />
          <Input defaultValue="Friday Night Modern" />
          <Input defaultValue="Disabled" disabled />
          <Input defaultValue="Read only" readOnly />
          <Input defaultValue="Invalid" aria-invalid />
          <Input type="date" defaultValue="2026-09-22" />
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search players" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear">
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup>
            <InputGroupInput placeholder="Entry fee" />
            <InputGroupAddon align="inline-end">
              <InputGroupText>USD</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex gap-2">
            <Input placeholder="judge@example.com" type="email" />
            <Button>Invite</Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Search" />
            <Button variant="outline">Filter</Button>
          </div>
          <Textarea
            className="col-span-2"
            placeholder="Describe the event. Markdown is fine."
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Selects
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <FormatSelect placeholder="Pick a format" />
          <FormatSelect defaultValue="Modern" />
          <FormatSelect defaultValue="Legacy" size="sm" />
          <FormatSelect defaultValue="Modern" disabled />
          <FormatSelect defaultValue="Modern" invalid />
          <p className="text-sm">
            Rounds are paired by{' '}
            <FormatSelect defaultValue="Modern" variant="ghost" /> rules.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Checkboxes and switches
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox /> Unchecked
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Checked
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked="indeterminate" /> Indeterminate
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox disabled /> Disabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox disabled defaultChecked /> Disabled checked
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox aria-invalid /> Invalid
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch /> Off
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch defaultChecked /> On
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch size="sm" /> Small off
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch size="sm" defaultChecked /> Small on
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled /> Disabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch disabled defaultChecked /> Disabled on
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Combobox
        </h2>
        <div className="grid max-w-2xl grid-cols-2 gap-3">
          <Combobox items={formats}>
            <ComboboxInput placeholder="Search formats" showClear />
            <ComboboxContent>
              <ComboboxEmpty>No formats found.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Combobox items={formats} defaultValue="Modern">
            <ComboboxInput disabled />
          </Combobox>
          <div className="col-span-2">
            <FormatChips />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Sidebar
        </h2>
        <AdminSidebarPreview />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Dropdown, dialog, popover, alert, sheet
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <EventMenu />
          <EventMenu withSelection />
          <EditEventDialog />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Round timer</Button>
            </PopoverTrigger>
            <PopoverContent align="start">
              <PopoverHeader>
                <PopoverTitle>Round timer</PopoverTitle>
                <PopoverDescription>
                  Minutes per round. Applies from the next round.
                </PopoverDescription>
              </PopoverHeader>
              <div className="flex gap-2">
                <Input type="number" defaultValue={50} />
                <Button>Set</Button>
              </div>
            </PopoverContent>
          </Popover>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Drop player</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <Trash2Icon />
                </AlertDialogMedia>
                <AlertDialogTitle>Drop Sam Rivera?</AlertDialogTitle>
                <AlertDialogDescription>
                  Their current match is recorded as a loss and they are left
                  out of future pairings. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep playing</AlertDialogCancel>
                <AlertDialogAction variant="destructive">
                  Drop
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Match details</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Table 12</SheetTitle>
                <SheetDescription>
                  Sam Rivera vs. Jordan Lee · Round 3
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-3 px-5">
                <label className="grid gap-1.5 text-sm font-medium">
                  Result
                  <FormatSelect placeholder="Report a result" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox /> Intentional draw
                </label>
              </div>
              <SheetFooter>
                <Button>Save result</Button>
                <Button variant="secondary">Cancel</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Badges, tabs, tooltip, separator
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Live</Badge>
          <Badge variant="brand">Round 3</Badge>
          <Badge variant="secondary">Draft</Badge>
          <Badge variant="outline">Test event</Badge>
          <Badge variant="destructive">Dropped</Badge>
          <Badge variant="ghost">Ghost</Badge>
          <Badge variant="link">Link</Badge>
          <Badge variant="secondary">
            <UsersIcon data-icon="inline-start" />
            32
          </Badge>
        </div>
        <div className="flex flex-wrap items-start gap-8">
          <Tabs defaultValue="main">
            <TabsList>
              <TabsTrigger value="main">Maindeck · 60</TabsTrigger>
              <TabsTrigger value="side">Sideboard · 15</TabsTrigger>
              <TabsTrigger value="notes" disabled>
                Notes
              </TabsTrigger>
            </TabsList>
            <TabsContent value="main">
              Segmented control, Themes size 2.
            </TabsContent>
            <TabsContent value="side">Sideboard.</TabsContent>
          </Tabs>
          <Tabs defaultValue="pairings">
            <TabsList variant="line">
              <TabsTrigger value="pairings">Pairings</TabsTrigger>
              <TabsTrigger value="standings">Standings</TabsTrigger>
              <TabsTrigger value="log">Log</TabsTrigger>
            </TabsList>
            <TabsContent value="pairings">
              Line tabs, Themes size 2.
            </TabsContent>
            <TabsContent value="standings">Standings.</TabsContent>
            <TabsContent value="log">Log.</TabsContent>
          </Tabs>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Pairings post at 7:05 PM</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-6" />
          <span>Left of the rule</span>
          <Separator orientation="vertical" className="h-6" />
          <span>Right of the rule</span>
        </div>
        <Separator />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Data table
        </h2>
        <DataTable
          columns={eventColumns}
          data={eventRows}
          pageSize={4}
          pageSizeOptions={[4, 10]}
          onRowClick={() => {}}
          toolbar={(table) => (
            <DataTableToolbar
              search={columnSearch(table.getColumn('name'), 'Search events')}
              filters={[
                {
                  id: 'status',
                  label: 'Status',
                  column: table.getColumn('status'),
                  options: [
                    {
                      value: 'live',
                      label: 'Live',
                      dotClassName: 'bg-round-live',
                    },
                    {
                      value: 'upcoming',
                      label: 'Upcoming',
                      dotClassName: 'bg-round-pairings',
                    },
                    {
                      value: 'completed',
                      label: 'Completed',
                      dotClassName: 'bg-gray-a8',
                    },
                  ],
                },
                {
                  id: 'startsAt',
                  kind: 'dateRange',
                  label: 'Date',
                  column: table.getColumn('startsAt'),
                },
                {
                  id: 'format',
                  label: 'Format',
                  secondary: true,
                  column: table.getColumn('format'),
                  options: formats.map((format) => ({
                    value: format,
                    label: format,
                  })),
                },
              ]}
              actions={
                <Button variant="brand">
                  <PlusIcon data-icon="inline-start" />
                  New event
                </Button>
              }
            />
          )}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <ResultsTable />
          <ResultsTable size="lg" />
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Fields, radio, progress, skeleton, breadcrumb, pagination, empty,
          item, calendar, scroll area
        </h2>
        <div className="grid max-w-3xl gap-6 md:grid-cols-2">
          <FieldSet>
            <FieldLegend>Registration</FieldLegend>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="f-name">Event name</FieldLabel>
                <Input id="f-name" defaultValue="Friday Night Modern" />
                <FieldDescription>Shown on the public page.</FieldDescription>
              </Field>
              <Field data-invalid>
                <FieldLabel htmlFor="f-cap">Capacity</FieldLabel>
                <Input id="f-cap" defaultValue="0" aria-invalid />
                <FieldError>Capacity must be at least 2.</FieldError>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="f-test" defaultChecked />
                <FieldLabel htmlFor="f-test">Mark as test event</FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
          <div className="flex flex-col gap-6">
            <RadioGroup defaultValue="swiss">
              <Field orientation="horizontal">
                <RadioGroupItem value="swiss" id="r-swiss" />
                <FieldLabel htmlFor="r-swiss">Swiss</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="elim" id="r-elim" />
                <FieldLabel htmlFor="r-elim">Single elimination</FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="rr" id="r-rr" disabled />
                <FieldLabel htmlFor="r-rr">Round robin</FieldLabel>
              </Field>
            </RadioGroup>
            <div className="flex flex-col gap-3">
              <Progress value={60} />
              <Progress value={60} size="lg" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Spinner />
            </div>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">Admin</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">Tournaments</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Friday Night Modern</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#" />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#">1</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive>
                    2
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href="#" />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
          <Empty className="bg-card shadow-[0_0_0_1px_var(--card-border)]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarIcon />
              </EmptyMedia>
              <EmptyTitle>No events yet</EmptyTitle>
              <EmptyDescription>
                Create your first event and it will show up here.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="brand">
                <PlusIcon data-icon="inline-start" />
                New event
              </Button>
            </EmptyContent>
          </Empty>
          <ItemGroup>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <UsersIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Sam Rivera</ItemTitle>
                <ItemDescription>Table 12 · 2–0–0</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="sm">
                  Drop
                </Button>
              </ItemActions>
            </Item>
            <Item variant="muted">
              <ItemContent>
                <ItemTitle>Jordan Lee</ItemTitle>
                <ItemDescription>Table 12 · 1–1–0</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">Bye</Badge>
              </ItemActions>
            </Item>
          </ItemGroup>
          <Calendar
            mode="range"
            defaultMonth={new Date(2026, 8, 1)}
            selected={{
              from: new Date(2026, 8, 22),
              to: new Date(2026, 8, 25),
            }}
            className="w-fit rounded-(--radius-4) bg-card shadow-[0_0_0_1px_var(--card-border)]"
          />
          <ScrollArea className="h-40 rounded-(--radius-3) bg-card shadow-[0_0_0_1px_var(--card-border)]">
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 16 }, (_, i) => (
                <div
                  key={i}
                  className="rounded-(--radius-2) px-2 py-1.5 text-sm hover:bg-gray-a2"
                >
                  Table {i + 1}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Cards
        </h2>
        <div className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Friday Night Modern</CardTitle>
              <CardDescription>Weekly · 32 registered</CardDescription>
              <CardAction>
                <EventMenu />
              </CardAction>
            </CardHeader>
            <CardContent>
              Round 3 of 5 is in play. Pairings were posted four minutes ago.
            </CardContent>
            <CardFooter className="gap-2">
              <Button variant="outline">Standings</Button>
              <Button variant="brand">Pairings</Button>
            </CardFooter>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Small card</CardTitle>
              <CardDescription>Themes size 1, 12px padding.</CardDescription>
            </CardHeader>
            <CardContent>Used for dense lists and sidebars.</CardContent>
          </Card>
          <a href="#cards" className="contents">
            <Card className="cursor-pointer">
              <CardHeader>
                <CardTitle>Interactive card</CardTitle>
                <CardDescription>
                  Wrapped in a link, so the hairline firms up on hover.
                </CardDescription>
              </CardHeader>
            </Card>
          </a>
          <Card>
            <CardHeader>
              <CardTitle>Registrations</CardTitle>
              <CardDescription>Since the event opened.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-bold tracking-tight">
              128
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          On a card
        </h2>
        <div className="bg-card flex items-center justify-between rounded-lg border p-4">
          <div>
            <div className="text-sm font-medium">Friday Night Modern</div>
            <div className="text-muted-foreground text-sm">
              32 registered · Round 3 of 5
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">Edit</Button>
            <Button variant="destructive">Cancel event</Button>
            <Button variant="brand">
              Generate pairings
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

/**
 * The admin sidebar's parts on one panel: brand and toggle in the header at
 * the app header's height, one unlabeled group plus a labeled one, the
 * current page and a sub-page, a count badge, a hover action, a disabled row,
 * and the workspace switcher pinned to the footer. `collapsible="none"`
 * keeps it in flow so the theme page can frame it; the icon rail is checked
 * in the real app.
 */
function AdminSidebarPreview() {
  return (
    <SidebarProvider className="min-h-0 w-fit overflow-hidden rounded-(--radius-4) shadow-2">
      <Sidebar collapsible="none" className="h-[30rem]">
        <SidebarHeader>
          <span className="flex items-center gap-2">
            <BrandMark className="size-6" />
            <span className="text-sm font-semibold">Paper Pairings</span>
          </span>
          <SidebarTrigger className="ml-auto" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <TrophyIcon />
                    <span>Tournaments</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>3</SidebarMenuBadge>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton isActive>
                        <span>Friday Night Modern</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton>
                        <span>Legacy Showdown</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <TentIcon />
                    <span>Conventions</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <UsersIcon />
                    <span>Staff</span>
                  </SidebarMenuButton>
                  <SidebarMenuAction showOnHover aria-label="Invite staff">
                    <PlusIcon />
                  </SidebarMenuAction>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Building2Icon />
                    <span>Organization</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Coming soon</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <CalendarIcon />
                    <span>Schedule</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="font-medium">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-(--radius-2) bg-gray-a3 text-xs font-semibold">
                  P
                </span>
                <span className="flex-1 truncate">Pauper Games</span>
                <ChevronsUpDownIcon className="ml-auto size-3.5" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  )
}

function FormatSelect({
  placeholder,
  defaultValue,
  size,
  variant,
  disabled,
  invalid,
}: {
  placeholder?: string
  defaultValue?: string
  size?: ComponentProps<typeof SelectTrigger>['size']
  variant?: ComponentProps<typeof SelectTrigger>['variant']
  disabled?: boolean
  invalid?: boolean
}) {
  return (
    <Select defaultValue={defaultValue} disabled={disabled}>
      <SelectTrigger
        size={size}
        variant={variant}
        aria-invalid={invalid || undefined}
        className={variant === 'ghost' ? undefined : 'w-40'}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Constructed</SelectLabel>
          {formats.slice(0, 4).map((format) => (
            <SelectItem key={format} value={format}>
              {format}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="Commander">Commander</SelectItem>
          <SelectItem value="Cube" disabled>
            Cube (soon)
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function FormatChips() {
  const anchor = useComboboxAnchor()
  return (
    <Combobox multiple items={formats} defaultValue={['Modern', 'Legacy']}>
      <ComboboxChips ref={anchor}>
        <ComboboxValue>
          {(values: Array<string>) => (
            <>
              {values.map((value) => (
                <ComboboxChip key={value}>{value}</ComboboxChip>
              ))}
              <ComboboxChipsInput placeholder="Add a format" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        <ComboboxEmpty>No formats found.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function EventMenu({ withSelection = false }: { withSelection?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Event actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Friday Night Modern</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <PencilIcon />
            Edit
            <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <UsersIcon />
              Share with
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Judges</DropdownMenuItem>
              <DropdownMenuItem>Players</DropdownMenuItem>
              <DropdownMenuItem>Everyone</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled>Archive</DropdownMenuItem>
        </DropdownMenuGroup>
        {withSelection && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked>
              Show test events
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>Show archived</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value="date">
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2Icon />
          Delete event
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EditEventDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Edit event</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit event</DialogTitle>
          <DialogDescription>
            Changes apply to the next round. Players already seated keep their
            pairings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <Input defaultValue="Friday Night Modern" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Capacity
            <Input type="number" defaultValue={32} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Mark as test event
          </label>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultsTable({
  size,
}: {
  size?: ComponentProps<typeof Table>['size']
}) {
  return (
    <Table size={size}>
      <TableCaption>
        {size === 'lg'
          ? 'Size 2: 44px rows, 12px padding.'
          : 'Size 1: 36px rows, 8px padding.'}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead className="text-right">Wins</TableHead>
          <TableHead className="text-right">Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Sam Rivera</TableCell>
          <TableCell className="text-right">2</TableCell>
          <TableCell className="text-right">3</TableCell>
        </TableRow>
        <TableRow data-state="selected">
          <TableCell>Jordan Lee</TableCell>
          <TableCell className="text-right">1</TableCell>
          <TableCell className="text-right">0</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Match</TableCell>
          <TableCell className="text-right">3</TableCell>
          <TableCell className="text-right">3</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
