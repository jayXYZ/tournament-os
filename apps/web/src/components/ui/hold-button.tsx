import * as React from 'react'

import type { VariantProps } from 'class-variance-authority'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Releasing early rewinds the fill this many times faster than it filled, so
// an aborted hold snaps back without feeling like a penalty.
const REWIND_FACTOR = 3
const SUCCESS_DISPLAY_MS = 1400

type HoldPhase = 'idle' | 'holding' | 'pending' | 'success'

// The sweep layer inverts the button: it must contrast with both the idle
// button face and the page behind it (hence the inset ring on `default`).
const overlayStyles = {
  default:
    'bg-primary-foreground text-primary inset-ring inset-ring-primary/25',
  destructive: 'bg-destructive text-white',
} satisfies Partial<Record<string, string>>

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A button for actions too consequential for a single click. The user must
 * hold it for `holdDuration` ms while an inversion sweep fills the face;
 * releasing early rewinds. When the hold completes, `onConfirm` runs and the
 * button confirms success in place before resetting.
 *
 * `onConfirm` must reject (rethrow) on failure so the success state is
 * skipped — surface the error yourself (e.g. a toast) before rethrowing.
 */
function HoldButton({
  className,
  variant = 'default',
  size = 'default',
  holdDuration = 800,
  successLabel,
  onConfirm,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<'button'>, 'onClick'> & {
  variant?: keyof typeof overlayStyles
  size?: VariantProps<typeof buttonVariants>['size']
  /** Milliseconds the button must be held before the action fires. */
  holdDuration?: number
  /** Shown on the button and announced once `onConfirm` resolves. */
  successLabel: string
  onConfirm: () => Promise<unknown> | unknown
}) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const progressRef = React.useRef(0)
  const heldRef = React.useRef(false)
  const rafRef = React.useRef(0)
  const lastTickRef = React.useRef(0)
  const resetTimerRef = React.useRef(0)
  const mountedRef = React.useRef(false)
  const phaseRef = React.useRef<HoldPhase>('idle')

  const [phase, setPhaseState] = React.useState<HoldPhase>('idle')
  // Captured when the hold completes: the live props may change mid-flight
  // (reactive queries swap the button to its next action) and the success
  // flash must describe the action that actually ran.
  const [confirmedLabel, setConfirmedLabel] = React.useState('')

  // Keep latest callbacks/props readable from stable rAF callbacks.
  const onConfirmRef = React.useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const successLabelRef = React.useRef(successLabel)
  successLabelRef.current = successLabel

  function setPhase(next: HoldPhase) {
    phaseRef.current = next
    setPhaseState(next)
  }

  function setProgress(value: number) {
    progressRef.current = value
    buttonRef.current?.style.setProperty('--hold-progress', String(value))
  }

  function stopLoop() {
    cancelAnimationFrame(rafRef.current)
  }

  function startLoop() {
    stopLoop()
    lastTickRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }

  function tick(now: number) {
    const elapsed = now - lastTickRef.current
    lastTickRef.current = now
    const direction = heldRef.current ? 1 : -REWIND_FACTOR
    const next = Math.min(
      1,
      Math.max(0, progressRef.current + (elapsed / holdDuration) * direction),
    )
    setProgress(next)

    if (heldRef.current && next >= 1) {
      complete()
      return
    }
    if (!heldRef.current && next <= 0) {
      if (phaseRef.current === 'holding') {
        setPhase('idle')
      }
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function press() {
    if (disabled) return
    const current = phaseRef.current
    if (current === 'pending' || current === 'success') return
    // A new press must start from zero: pressing during a rewind (early
    // release or the post-success retract) must not resume from the residual
    // fill, or the action could fire after a near-zero hold. Only an already
    // active hold (duplicate press event) keeps its progress.
    if (!heldRef.current) setProgress(0)
    heldRef.current = true
    setPhase('holding')
    startLoop()
  }

  function release() {
    heldRef.current = false
    if (phaseRef.current !== 'holding') return
    if (prefersReducedMotion()) {
      stopLoop()
      setProgress(0)
      setPhase('idle')
    }
    // Otherwise the running loop rewinds the fill and settles back to idle.
  }

  function complete() {
    heldRef.current = false
    stopLoop()
    setProgress(1)
    setConfirmedLabel(successLabelRef.current)
    setPhase('pending')
    Promise.resolve()
      .then(() => onConfirmRef.current())
      .then(
        () => {
          if (!mountedRef.current) return
          setPhase('success')
          resetTimerRef.current = window.setTimeout(
            retract,
            SUCCESS_DISPLAY_MS,
          )
        },
        () => {
          if (mountedRef.current) retract()
        },
      )
  }

  function retract() {
    setPhase('idle')
    if (prefersReducedMotion()) {
      stopLoop()
      setProgress(0)
      return
    }
    heldRef.current = false
    startLoop()
  }

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (disabled) release()
  }, [disabled])

  const busy = phase === 'pending' || phase === 'success'

  return (
    <button
      type="button"
      {...props}
      ref={buttonRef}
      data-slot="button"
      data-phase={phase}
      disabled={disabled && !busy}
      aria-disabled={disabled || busy || undefined}
      className={cn(
        buttonVariants({ variant, size }),
        'relative touch-none overflow-hidden',
        className,
      )}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        press()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        if (!event.repeat) press()
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') release()
      }}
      onBlur={release}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-0 flex items-center justify-center gap-1 whitespace-nowrap',
          overlayStyles[variant],
        )}
        style={{
          clipPath: 'inset(0 calc((1 - var(--hold-progress, 0)) * 100%) 0 0)',
        }}
      >
        <span
          className={cn(
            'flex items-center gap-1',
            phase === 'pending' && 'hold-pending-pulse',
          )}
        >
          {phase === 'success' ? (
            <>
              <SuccessCheck />
              {confirmedLabel}
            </>
          ) : (
            children
          )}
        </span>
      </span>
      <span role="status" className="sr-only">
        {phase === 'success' ? confirmedLabel : null}
      </span>
    </button>
  )
}

function SuccessCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        className="hold-check-draw"
        pathLength={1}
        d="M4.5 12.75 10 18.25 19.5 7.75"
      />
    </svg>
  )
}

export { HoldButton }
