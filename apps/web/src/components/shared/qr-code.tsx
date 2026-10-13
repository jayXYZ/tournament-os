import { QRCodeSVG } from 'qrcode.react'

import { cn } from '@/lib/utils'

// Rendering options every QR code in the app shares, so a downloaded PNG
// (rendered separately through QRCodeCanvas) matches the one on screen.
// Always dark on white with the 4-module quiet zone the spec asks for: phone
// cameras read inverted or low-contrast codes poorly, so the theme never
// recolors it. Level M survives a smudged or partly covered print.
export const QR_CODE_OPTIONS = {
  level: 'M',
  marginSize: 4,
  bgColor: '#FFFFFF',
  fgColor: '#000000',
} as const

// A scannable QR code that fills its container's width. The title is its
// accessible name.
export function QrCode({
  value,
  title,
  className,
}: {
  value: string
  title: string
  className?: string
}) {
  return (
    <QRCodeSVG
      {...QR_CODE_OPTIONS}
      value={value}
      title={title}
      className={cn('h-auto w-full', className)}
    />
  )
}
