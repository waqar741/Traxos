import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearCache } from '../lib/cache'

interface AuthContextType {
  user: User | null
  profile: any | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signInWithOtp: (email: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  updateEmail: (email: string) => Promise<void>
  refreshProfile: () => Promise<void>
  reauthenticate: (password: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Safety timeout to prevent infinite loading
    const safetyTimeout = setTimeout(() => {
      if (mounted && loading) {
        // Silently complete loading if it takes too long to prevent blocking the UI
        setLoading(false)
      }
    }, 10000)

    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return

        const currentUser = session?.user ?? null
        setUser(currentUser)

        // Stop loading immediately after checking session
        // Profile fetch can happen in background
        setLoading(false)

        if (currentUser) {
          fetchProfile(currentUser.id)
        }
      } catch (error) {
        console.error('Error initializing auth:', error)
        if (mounted) {
          setLoading(false)
        }
      }
    }

    initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return

      const currentUser = session?.user ?? null
      setUser(currentUser)

      // Ensure loading is false on auth change usually
      setLoading(false)

      if (currentUser) {
        fetchProfile(currentUser.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
    }
  }, [])

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching profile:', error)
        setProfile(null)
      } else if (data) {
        setProfile(data)
      } else {
        setProfile(null)
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
      setProfile(null)
    }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  const signInWithOtp = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL === 'your_supabase_url') {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials in the .env file.')
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    })

    console.log('SignUp Response:', {
      user: data.user,
      session: data.session,
      confirmed_at: data.user?.email_confirmed_at
    })

    if (error) throw error

    if (data.session) {
      console.warn('WARNING: Session created immediately. Email verification might be disabled in Supabase settings.')
    }
  }

  const signOut = async () => {
    if (!import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL === 'your_supabase_url') {
      throw new Error('Supabase is not configured. Please set up your Supabase credentials in the .env file.')
    }

    clearCache() // Clear all cached data on sign out
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    })
    if (error) throw error
  }

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({
      password
    })
    if (error) throw error
  }

  const updateEmail = async (email: string) => {
    const { error } = await supabase.auth.updateUser({
      email
    })
    if (error) throw error
  }

  const reauthenticate = async (password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: user?.email || '',
      password,
    })
    if (error) throw new Error('Incorrect password')
  }

  const deleteAccount = async (password: string) => {
    // 1. Re-authenticate to verify password
    await reauthenticate(password)

    // 2. Try to delete via RPC (if configured)
    const { error: rpcError } = await supabase.rpc('delete_user')

    if (rpcError) {
      console.warn('RPC delete_user failed or not found, falling back to manual cleanup', rpcError)
      // 3. Fallback: Manual Data Cleanup (policies must allow this)
      const tables = [
        'transactions',
        'accounts',
        'goals',
        'group_expenses',
        'debts_credits',
        'notifications',
        'profiles'
      ]

      for (const table of tables) {
        const { error: deleteError } = await supabase
          .from(table)
          .delete()
          .eq(table === 'profiles' ? 'id' : 'user_id', user?.id)

        if (deleteError) console.error(`Failed to delete from ${table}:`, deleteError)
      }
    }

    // 4. Sign out
    await signOut()
  }

  const value = {
    user,
    profile,
    loading,
    signIn,
    signInWithOtp,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    updateEmail,
    refreshProfile: async () => {
      if (user) await fetchProfile(user.id)
    },
    reauthenticate,
    deleteAccount
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}