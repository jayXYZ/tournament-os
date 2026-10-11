import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

/**
 * tailwind-merge only knows the built-in utilities, so it is told about the
 * focus-ring utilities from styles/app.css: they set outline width, style,
 * color and offset, so a consumer's `focus-visible:outline-none` (or any
 * other outline-* utility) must replace them, and vice versa.
 */
const twMerge = extendTailwindMerge<'focus-ring'>({
  extend: {
    classGroups: {
      'focus-ring': ['focus-ring', 'focus-ring-outset'],
      'bg-image': ['field-wash'],
    },
    conflictingClassGroups: {
      'focus-ring': [
        'outline-style',
        'outline-w',
        'outline-color',
        'outline-offset',
      ],
      'outline-style': ['focus-ring'],
      'outline-w': ['focus-ring'],
      'outline-color': ['focus-ring'],
      'outline-offset': ['focus-ring'],
    },
  },
})

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}
