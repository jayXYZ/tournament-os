// Minimal structural typing for the pieces of the Clerk browser global the
// E2E auth setup drives. Kept local so the tests don't depend on Clerk's
// transitive type packages.
declare global {
  interface Window {
    Clerk?: {
      loaded: boolean
      user: unknown
      client?: {
        signIn: {
          create: (params: {
            strategy: 'ticket'
            ticket: string
          }) => Promise<{ createdSessionId: string | null }>
        }
      }
      setActive: (params: { session: string | null }) => Promise<void>
    }
  }
}

export {}
