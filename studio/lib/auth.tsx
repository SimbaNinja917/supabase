import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/router'
import { PropsWithChildren, useCallback, useEffect, useRef } from 'react'

import {
  AuthContext as AuthContextInternal,
  AuthProvider as AuthProviderInternal,
  gotrueClient,
  useTelemetryProps,
} from 'common'
import { useProfileQuery } from 'data/profile/profile-query'
import { useStore } from 'hooks'
import Telemetry from 'lib/telemetry'
import { GOTRUE_ERRORS, IS_PLATFORM } from './constants'
import { clearLocalStorage, resetSignInClicks } from './local-storage'
import { useProfileCreateMutation } from 'data/profile/profile-create-mutation'

export const AuthContext = AuthContextInternal

export const AuthProvider = ({ children }: PropsWithChildren<{}>) => {
  const { ui, app } = useStore()
  const router = useRouter()
  const telemetryProps = useTelemetryProps()

  // Check for unverified GitHub users after a GitHub sign in
  useEffect(() => {
    async function handleEmailVerificationError() {
      const { error } = await gotrueClient.initialize()

      if (error?.message === GOTRUE_ERRORS.UNVERIFIED_GITHUB_USER) {
        ui.setNotification({
          category: 'error',
          message:
            'Please verify your email on GitHub first, then reach out to us at support@supabase.io to log into the dashboard',
        })
      }
    }

    handleEmailVerificationError()
  }, [])

  useEffect(() => {
    const {
      data: { subscription },
    } = gotrueClient.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        Telemetry.sendEvent(
          { category: 'account', action: 'sign_in', label: '' },
          telemetryProps,
          router
        )
      }
    })

    return subscription.unsubscribe
  }, [])

  const { mutate: createProfile } = useProfileCreateMutation({
    onSuccess() {
      Telemetry.sendEvent(
        { category: 'conversion', action: 'sign_up', label: '' },
        telemetryProps,
        router
      )
    },
    onError(err) {
      ui.setNotification({
        category: 'error',
        message: 'Failed to create your profile. Please refresh to try again.',
      })
    },
  })

  // Track telemetry for the current user
  useProfileQuery({
    onSuccess(profile) {
      Telemetry.sendIdentify(profile, telemetryProps)

      // [Joshen] Temp fix: For new users, the GET profile call also creates a default org
      // But because the dashboard's logged in state is using gotrue as the source of truth
      // the home page loads before the GET profile call completes (and consequently before the
      // creation of the default org). Hence why calling org load here
      app.organizations.load()
    },
    onError(err) {
      // if the user does not yet exist, create a profile for them
      if (typeof err === 'object' && err !== null && 'code' in err && (err as any).code === 404) {
        createProfile()
      }
    },
  })

  return <AuthProviderInternal alwaysLoggedIn={!IS_PLATFORM}>{children}</AuthProviderInternal>
}

export { useAuth, useIsLoggedIn, useSession, useUser } from 'common'

export function useSignOut() {
  const queryClient = useQueryClient()

  return useCallback(async () => {
    resetSignInClicks()

    const result = await gotrueClient.signOut()
    clearLocalStorage()
    await queryClient.resetQueries()

    return result
  }, [])
}
