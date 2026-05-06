import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getCached, setCached, invalidateCacheByPrefix } from '../lib/cache'
import { useForm } from 'react-hook-form'
import { Plus, Wallet, CreditCard, Banknote, Smartphone, Users, X, Pencil, Trash2, ArrowRightLeft, Loader, Shield } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'
import { useCurrency } from '../hooks/useCurrency'
import PageGuide from '../components/PageGuide'

interface Account {
  id: string
  name: string
  type: string
  balance: number
  currency: string
  color: string
  is_active: boolean
  created_at: string
  is_default: boolean
  interest_rate?: number
  interest_frequency?: string
}

interface AccountForm {
  name: string
  type: string
  balance: number
  color: string
  interest_rate?: number
  interest_frequency?: string
}

interface TransferForm {
  from_account_id: string
  to_account_id: string
  amount: number
  description: string
}

export default function Accounts() {
  const { user } = useAuth()
  const { formatCurrency, currency } = useCurrency()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null)

  // Error Modal State
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
    setError
  } = useForm<AccountForm>({
    defaultValues: {
      type: 'bank',
      balance: 0,
      color: '#3B82F6'
    }
  })

  const watchedType = watch('type')

  const {
    register: registerTransfer,
    handleSubmit: handleTransferSubmit,
    reset: resetTransfer,
    formState: { errors: transferErrors, isSubmitting: transferIsSubmitting },
    setError: setTransferError
  } = useForm<TransferForm>()

  useEffect(() => {
    if (user) {
      fetchAccounts()
    }
  }, [user])

  const fetchAccounts = async (skipCache = false) => {
    try {
      const cacheKey = `accounts:${user?.id}`

      if (!skipCache) {
        const cached = getCached<Account[]>(cacheKey)
        if (cached) {
          setAccounts(cached)
          setLoading(false)
          return
        }
      }

      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user?.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error

      if (data) {
        setAccounts(data)
        setCached(cacheKey, data)
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  // Invalidate related caches after any account mutation
  const invalidateAccountCaches = () => {
    invalidateCacheByPrefix('accounts:')
    invalidateCacheByPrefix('dashboard:')
    invalidateCacheByPrefix('transactions:')
    invalidateCacheByPrefix('transactions_list:')
  }



  const onSubmit = async (data: AccountForm) => {
    try {
      if (editingAccount) {
        const updateData: any = {
          name: data.name,
          type: data.type,
          color: data.color,
          // interest_rate: data.interest_rate || null,
          // interest_frequency: data.interest_frequency || null
        }

        const { data: transactions } = await supabase
          .from('transactions')
          .select('id')
          .eq('account_id', editingAccount.id)
          .eq('account_id', editingAccount.id)
          .limit(1)

        const { data: transfersFrom } = await supabase
          .from('transfers')
          .select('id')
          .eq('from_account_id', editingAccount.id)
          .limit(1)

        const { data: transfersTo } = await supabase
          .from('transfers')
          .select('id')
          .eq('to_account_id', editingAccount.id)
          .limit(1)

        const hasHistory = (transactions && transactions.length > 0) ||
          (transfersFrom && transfersFrom.length > 0) ||
          (transfersTo && transfersTo.length > 0)

        if (!hasHistory) {
          updateData.balance = data.balance
        } else if (data.balance !== editingAccount.balance) {
          setError('root', {
            message: 'Balance cannot be changed for accounts with transaction or transfer history. Use transfers or transactions instead.'
          })
          return
        }

        const { error } = await supabase
          .from('accounts')
          .update(updateData)
          .eq('id', editingAccount.id)

        if (error) throw error
      } else {
        if (accounts.length >= 10) {
          setError('root', { message: 'You can only create up to 10 accounts. Please delete an existing account to create a new one.' })
          return
        }

        const { error } = await supabase
          .from('accounts')
          .insert({
            user_id: user?.id,
            name: data.name,
            type: data.type,
            balance: data.balance,
            color: data.color,
            is_active: true,
            is_default: accounts.length === 0, // Make first account default
            // interest_rate: data.interest_rate || null,
            // interest_frequency: data.interest_frequency || null
          })

        if (error) throw error
      }

      invalidateAccountCaches()
      await fetchAccounts(true)
      handleCloseModal()
    } catch (error: any) {
      setError('root', { message: error.message })
    }
  }

  const onTransferSubmit = async (data: TransferForm) => {
    try {
      if (data.from_account_id === data.to_account_id) {
        setTransferError('root', { message: 'From and To accounts must be different' })
        return
      }

      const fromAccount = accounts.find(a => a.id === data.from_account_id)
      if (fromAccount && fromAccount.balance < data.amount) {
        setTransferError('root', { message: 'Insufficient balance in from account' })
        return
      }

      const { error } = await supabase
        .from('transfers')
        .insert({
          user_id: user?.id,
          from_account_id: data.from_account_id,
          to_account_id: data.to_account_id,
          amount: data.amount,
          description: data.description
        })

      if (error) throw error

      const toAccount = accounts.find(a => a.id === data.to_account_id)

      if (fromAccount && toAccount) {
        await Promise.all([
          supabase
            .from('accounts')
            .update({ balance: fromAccount.balance - data.amount })
            .eq('id', data.from_account_id),
          supabase
            .from('accounts')
            .update({ balance: toAccount.balance + data.amount })
            .eq('id', data.to_account_id)
        ])
      }

      invalidateAccountCaches()
      await fetchAccounts(true)
      setShowTransferModal(false)
      resetTransfer()
    } catch (error: any) {
      setTransferError('root', { message: error.message })
    }
  }

  const initiateDeleteAccount = (account: Account) => {
    if (account.is_default) {
      setErrorMessage('Cannot delete the default account. This account is required for the application to function properly.')
      setShowErrorModal(true)
      return
    }

    if (account.balance !== 0) {
      setErrorMessage('Account cannot be deleted while it has a non-zero balance. Please transfer or withdraw funds first.')
      setShowErrorModal(true)
      return
    }

    setAccountToDelete(account)
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = async () => {
    if (!accountToDelete) return

    try {
      setDeletingAccountId(accountToDelete.id)
      setShowDeleteModal(false)

      const { error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', accountToDelete.id)

      if (error) {
        if (error.code === '23503') { // Foreign key violation
          throw new Error('Cannot delete account because it has associated transactions or goals. Please delete them first.')
        }
        throw error
      }
      invalidateAccountCaches()
      await fetchAccounts(true)
    } catch (error: any) {
      console.error('Error deleting account:', error)
      alert(`Error deleting account: ${error.message}`)
    } finally {
      setDeletingAccountId(null)
      setAccountToDelete(null)
    }
  }



  const handleCloseModal = () => {
    setShowModal(false)
    setEditingAccount(null)
    reset()
  }

  const handleEditAccount = (account: Account) => {
    setEditingAccount(account)
    reset({
      name: account.name,
      type: account.type,
      balance: account.balance,
      color: account.color,
      interest_rate: account.interest_rate,
      interest_frequency: account.interest_frequency
    })
    setShowModal(true)
  }



  // Removed local formatCurrency function in favor of useCurrency hook

  const getAccountIcon = (type: string) => {
    switch (type) {
      case 'bank': return Wallet
      case 'cash': return Banknote
      case 'wallet': return Smartphone
      case 'credit_card': return CreditCard
      case 'other': return Users
      default: return Wallet
    }
  }

  const accountTypes = [
    { value: 'bank', label: 'Bank Account' },
    { value: 'cash', label: 'Cash' },
    { value: 'wallet', label: 'Digital Wallet' },
    { value: 'credit_card', label: 'Credit Card' },
    { value: 'investment', label: 'Investment' },
    { value: 'savings', label: 'Savings' },
    { value: 'other', label: 'Other' }
  ]

  const colorOptions = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
    '#8B5CF6', '#F97316', '#06B6D4', '#84CC16'
  ]



  // Empty State / Welcome UI
  if (!loading && accounts.length === 0) {
    return (
      <div className="space-y-6">
        <header className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Welcome to Traxos!</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Let's get started by creating your main account.
            </p>
          </div>
          <button
            onClick={() => {
              setEditingAccount(null)
              setEditingAccount(null)
              reset({ type: 'bank' })
              setShowModal(true)
            }}
            className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>Create Default Account</span>
          </button>
        </header>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-6 text-center">
          <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-800 rounded-lg flex items-center justify-center mb-4">
            <Wallet className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Accounts Yet</h3>
          <p className="text-gray-600 dark:text-gray-300 max-w-md mx-auto">
            You need at least one account to start tracking your expenses and income. The first account you create will be your <strong>Default Account</strong>.
          </p>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-4">
            Tip: You can set an initial balance for this account, which will serve as your starting point. This initial balance will not be recorded as a transaction.
          </p>
        </div>

        {/* Modal needs to be rendered here as well */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingAccount ? 'Edit Account' : 'Setup Default Account'}
                </h2>
                <button
                  onClick={handleCloseModal}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Account Name
                  </label>
                  <input
                    {...register('name', { required: 'Account name is required' })}
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    placeholder="e.g., Main Bank Account"
                  />
                  {errors.name && (
                    <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Account Type
                  </label>
                  <select
                    {...register('type')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {accountTypes.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Initial Balance ({currency})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500 dark:text-gray-400">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(0).replace(/\d/g, '').replace(/[.,]/g, '').trim()}
                    </span>
                    <input
                      {...register('balance', {
                        required: 'Initial balance is required',
                        valueAsNumber: true
                      })}
                      type="number"
                      step="0.01"
                      className="w-full pl-7 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="0.00"
                    />
                  </div>
                  {errors.balance && (
                    <p className="text-red-500 text-sm mt-1">{errors.balance.message}</p>
                  )}
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    This will be the starting balance and cannot be changed later without transactions.
                  </p>
                </div>

                {/* Conditional Interest Fields - DEBUG MODE (Always Visible) */}
                <div className="p-2 bg-blue-50 text-blue-800 text-xs mb-2 rounded border border-blue-200">
                  DEBUG INFO: Account Type is "{watchedType}"
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Interest Rate (%)
                    </label>
                    <input
                      {...register('interest_rate', { valueAsNumber: true })}
                      type="number"
                      step="0.01"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="e.g. 6.5"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Interest Frequency
                    </label>
                    <select
                      {...register('interest_frequency')}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="">Select...</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Bi-Annually">Bi-Annually</option>
                      <option value="Annually">Annually</option>
                    </select>
                  </div>
                </div>


                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Color
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#64748B', '#A855F7', '#D946EF'].map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          // We need to set the value manually since it's not a standard input
                          const event = { target: { name: 'color', value: color } }
                          register('color').onChange(event)
                          // Verify visual selection logic in main component or use watch to highlight
                        }}
                        className={`w-8 h-8 rounded-lg border-2 ${
                          // This logic relies on watch() which we need to ensure is available if we copy-paste
                          // For simplicity in this block we can just use the register returned onChange or just rely on standard form handling
                          // Let's assume standard behavior for now, but better to use a proper color picker component logic if existing.
                          'border-gray-200 dark:border-gray-600'
                          }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                    {/* Re-implementing the color picker simpler for this view to match existing or simplify */}
                    <input
                      type="color"
                      {...register('color')}
                      className="h-10 w-full"
                    />
                  </div>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-green-400"
                  >
                    {isSubmitting ? (
                      <Loader className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      'Create Account'
                    )}
                  </button>
                </div>
              </form>
            </div >
          </div >
        )
        }
      </div >
    )
  }

  const sortedAccounts = [...accounts]
    .filter(a => a.is_active)
    .sort((a, b) => {
      if (a.is_default && !b.is_default) return -1
      if (!a.is_default && b.is_default) return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const totalBalance = sortedAccounts.reduce((sum, account) => sum + account.balance, 0)

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pb-4 pt-2 sm:p-6 space-y-4 sm:space-y-6">
      {/* Desktop Header - Your original code */}
      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Accounts</h1>
            <PageGuide
              title="Accounts"
              description="Manage your physical and digital wallets. Track balances across different banks and keep your net worth updated."
              tips={[
                "Add all your bank accounts for a complete picture.",
                "You cannot edit an account's balance directly.",
                "Initial balance can only be set when creating a new account. This entry will not appear in your transactions.",
                "To delete an account, its balance must be 0. Transfer or withdraw funds first.",
                "Set a default account for quick transactions."
              ]}
            />
          </div>
        </div>
        <div className="flex space-x-2 mt-4 sm:mt-0">
          <button
            onClick={() => setShowTransferModal(true)}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            Transfer
          </button>
          <button
            onClick={() => {
              setEditingAccount(null)
              reset({ type: 'bank' })
              setShowModal(true)
            }}
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Account
          </button>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="sm:hidden flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Accounts</h1>
            <PageGuide
              title="Accounts"
              description="Manage your money sources and balances."
              tips={[
                "Balance cannot be edited directly.",
                "Initial balance is only set on creation (hidden from transactions).",
                "Accounts must have 0 balance to be deleted."
              ]}
            />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowTransferModal(true)}
            className="flex items-center p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            title="Transfer"
          >
            <ArrowRightLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setEditingAccount(null)
              reset({ type: 'bank' })
              setShowModal(true)
            }}
            className="flex items-center p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            title="Add Account"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Desktop Total Balance - Your original code */}
      <div className="hidden sm:block bg-gradient-to-r from-green-500 to-blue-600 rounded-xl p-6 text-white">
        <h2 className="text-lg font-medium opacity-90">Total Balance</h2>
        <p className="text-3xl font-bold mt-2">{formatCurrency(totalBalance)}</p>
        <p className="text-sm opacity-75 mt-1">{sortedAccounts.length} active accounts</p>
      </div>

      {/* Mobile Total Balance */}
      {/* --- START: Edited Mobile-Optimized Code --- */}

      {/* Mobile View - Structured Total Balance Card */}
      <div className="sm:hidden bg-gradient-to-r from-green-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          {/* Text content on the left for clear hierarchy */}
          <div>
            <h2 className="text-base font-medium opacity-90">Total Balance</h2>
            <p className="text-3xl font-bold tracking-tight mt-1">{formatCurrency(totalBalance)}</p>
            <p className="text-xs opacity-80 mt-2">{sortedAccounts.length} active accounts</p>
          </div>

          {/* Icon on the right as a visual anchor */}
          <div className="flex-shrink-0">
            {/* Assuming you are using lucide-react or a similar icon library */}
            {/* Replace <WalletIcon> with your actual icon component */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
          </div>
        </div>
      </div>

      {/* --- END: Edited Mobile-Optimized Code --- */}
      {/* Desktop Accounts Grid - Your original code */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedAccounts.length === 0 ? (
          <div className="col-span-full text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
            <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">Setting up your account...</p>
          </div>
        ) : (
          sortedAccounts.map((account) => {
            const IconComponent = getAccountIcon(account.type)
            const isDeleting = deletingAccountId === account.id
            const isDefaultAccount = account.is_default

            return (
              <div key={account.id} className={`bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border ${isDefaultAccount ? 'border-blue-300 dark:border-blue-700' : 'border-gray-100 dark:border-gray-700'
                } relative`}>

                {isDefaultAccount && (
                  <div className="absolute -top-2 -left-2 bg-blue-500 text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center">
                    <Shield className="w-3 h-3 mr-1" />
                    Default
                  </div>
                )}

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div
                      className="p-3 rounded-lg"
                      style={{ backgroundColor: account.color + '20' }}
                    >
                      <IconComponent
                        className="w-6 h-6"
                        style={{ color: account.color }}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{account.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">
                        {accountTypes.find(t => t.value === account.type)?.label || account.type}
                        {account.interest_rate && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                            {account.interest_rate}% {account.interest_frequency && `(${account.interest_frequency})`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleEditAccount(account)}
                      disabled={isDeleting}
                      className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Edit account"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => initiateDeleteAccount(account)}
                      disabled={isDeleting}
                      className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={
                        isDefaultAccount
                          ? "Cannot delete default account"
                          : account.balance !== 0
                            ? "Cannot delete account with balance"
                            : "Archive account"
                      }
                    >
                      {isDeleting ? (
                        <Loader className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="text-right">
                  <p className={`text-2xl font-bold ${account.balance >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {formatCurrency(account.balance)}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {account.currency}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Mobile Accounts Grid */}
      <div className="sm:hidden grid grid-cols-1 gap-4">
        {sortedAccounts.length === 0 ? (
          <div className="col-span-full text-center py-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
            <Wallet className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400 text-sm">Setting up your account...</p>
          </div>
        ) : (
          sortedAccounts.map((account) => {
            const IconComponent = getAccountIcon(account.type)
            const isDeleting = deletingAccountId === account.id
            const isDefaultAccount = account.is_default

            return (
              <div key={account.id} className={`bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border ${isDefaultAccount ? 'border-blue-300 dark:border-blue-700' : 'border-gray-100 dark:border-gray-700'
                } relative`}>

                {isDefaultAccount && (
                  <div className="absolute -top-1 -left-1 bg-blue-500 text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center">
                    <Shield className="w-2 h-2 mr-1" />
                    Default
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <div
                      className="p-2 rounded-lg flex-shrink-0"
                      style={{ backgroundColor: account.color + '20' }}
                    >
                      <IconComponent
                        className="w-5 h-5"
                        style={{ color: account.color }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{account.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 capitalize truncate">
                        {accountTypes.find(t => t.value === account.type)?.label || account.type}
                        {account.interest_rate && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                            {account.interest_rate}%
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end ml-3">
                    <p className={`text-lg font-bold ${account.balance >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                      {formatCurrency(account.balance)}
                    </p>
                    <div className="flex items-center space-x-1 mt-1">
                      <button
                        onClick={() => handleEditAccount(account)}
                        disabled={isDeleting}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Edit account"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => initiateDeleteAccount(account)}
                        disabled={isDeleting}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Delete account"
                      >
                        {isDeleting ? (
                          <Loader className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Account Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingAccount ? 'Edit Account' : 'Add Account'}
                </h2>
                {/* Show counter */}
                {!editingAccount && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${accounts.length >= 10
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    }`}>
                    {accounts.length}/10 Used
                  </span>
                )}
              </div>
              <button
                onClick={handleCloseModal}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account Name
                </label>
                <input
                  {...register('name', { required: 'Account name is required' })}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g., Main Bank Account"
                />
                {errors.name && (
                  <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account Type
                </label>
                <select
                  {...register('type')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {accountTypes.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Initial Balance ({currency})
                </label>
                <input
                  {...register('balance', {
                    required: 'Balance is required',
                    valueAsNumber: true
                  })}
                  type="number"
                  step="0.01"
                  className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${editingAccount ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''
                    }`}
                  placeholder="10000"
                  readOnly={!!editingAccount}
                  title={editingAccount ? "Balance cannot be edited for existing accounts" : "Initial balance"}
                />
                {errors.balance && (
                  <p className="text-red-500 text-sm mt-1">{errors.balance.message}</p>
                )}
                {editingAccount && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Balance cannot be edited for accounts with transaction history
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Color
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {colorOptions.map((color) => (
                    <label key={color} className="cursor-pointer">
                      <input
                        {...register('color')}
                        type="radio"
                        value={color}
                        className="sr-only"
                      />
                      <div
                        className="w-10 h-10 rounded-lg border-2 border-gray-200 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
                        style={{ backgroundColor: color }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              {/* Warning removed and moved to PageGuide */}

              {errors.root && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-red-700 dark:text-red-400 text-sm">{errors.root.message}</p>
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:bg-green-400 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Saving...' : (editingAccount ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Transfer Funds</h2>
              <button
                onClick={() => setShowTransferModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit(onTransferSubmit)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  From Account
                </label>
                <select
                  {...registerTransfer('from_account_id', { required: 'From account is required' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select account</option>
                  {sortedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} {account.is_default && '(Default)'} ({formatCurrency(account.balance)})
                    </option>
                  ))}
                </select>
                {transferErrors.from_account_id && (
                  <p className="text-red-500 text-sm mt-1">{transferErrors.from_account_id.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  To Account
                </label>
                <select
                  {...registerTransfer('to_account_id', { required: 'To account is required' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select account</option>
                  {sortedAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} {account.is_default && '(Default)'} ({formatCurrency(account.balance)})
                    </option>
                  ))}
                </select>
                {transferErrors.to_account_id && (
                  <p className="text-red-500 text-sm mt-1">{transferErrors.to_account_id.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount (₹)
                </label>
                <input
                  {...registerTransfer('amount', {
                    required: 'Amount is required',
                    min: { value: 0.01, message: 'Amount must be greater than 0' },
                    valueAsNumber: true
                  })}
                  type="number"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="1000"
                />
                {transferErrors.amount && (
                  <p className="text-red-500 text-sm mt-1">{transferErrors.amount.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description (Optional)
                </label>
                <input
                  {...registerTransfer('description')}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Transfer reason"
                />
              </div>

              {transferErrors.root && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-red-700 dark:text-red-400 text-sm">{transferErrors.root.message}</p>
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferIsSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
                >
                  {transferIsSubmitting ? 'Transferring...' : 'Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Account"
        message="Are you sure you want to delete this account? The account will be hidden but all transaction history will be preserved. You can verify this in your transaction history."
        type="warning"
        confirmText="Delete Account"
      />
      {/* Error Alert Modal */}
      <ConfirmModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        onConfirm={() => setShowErrorModal(false)}
        title="Cannot Delete Account"
        message={errorMessage}
        confirmText="OK"
        showCancel={false}
        type="warning"
      />
    </div>
  )
}