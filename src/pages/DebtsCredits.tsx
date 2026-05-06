import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getCached, setCached, invalidateCacheByPrefix } from '../lib/cache'
import { useForm } from 'react-hook-form'
import { Plus, User, X, Trash2, Wallet, Mic, Search, ChevronDown, ChevronUp, Pencil, Calendar, Banknote, Phone } from 'lucide-react'
import { format } from 'date-fns'
import ConfirmModal from '../components/ConfirmModal'
import { useCurrency } from '../hooks/useCurrency'
import PageGuide from '../components/PageGuide'
import { useVoiceTransaction } from '../hooks/useVoiceTransaction'

// --- Types ---
interface DebtCredit {
  id: string
  person_name: string
  amount: number
  type: 'debt' | 'credit' // debt = you owe them, credit = they owe you
  description: string
  due_date: string | null
  is_settled: boolean
  created_at: string
  phone_number: string | null
  settlement_transaction_id: string | null
  settlement_account_id: string | null
  settlement_transaction?: {
    created_at: string
  }
}

interface PersonGroup {
  person_name: string
  items: DebtCredit[]
  total_debt: number
  total_credit: number
  net_amount: number // credit - debt
}



interface Account {
  id: string
  name: string
  balance: number
  is_active: boolean
}

interface DebtCreditForm {
  person_name: string
  amount: number
  type: 'debt' | 'credit'
  description: string
  due_date?: string
  phone_number?: string
}

export default function DebtsCredits() {
  const { user } = useAuth()
  const { formatCurrency } = useCurrency()
  const [debtsCredits, setDebtsCredits] = useState<DebtCredit[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<DebtCredit | null>(null)
  const [duplicateMessage, setDuplicateMessage] = useState('')
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())
  const [showAccountSelection, setShowAccountSelection] = useState(false)
  const [pendingSettlementItem, setPendingSettlementItem] = useState<DebtCredit | null>(null)

  // Filtering State
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'i_owe' | 'owes_me'>('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)

  // Expanded State for Parent Rows
  const [expandedPeople, setExpandedPeople] = useState<Set<string>>(new Set())
  const [expandedChildLists, setExpandedChildLists] = useState<Set<string>>(new Set())

  // Pagination State
  const [visibleCount, setVisibleCount] = useState(15)

  // Collapsible Settled Section
  const [showSettled, setShowSettled] = useState(false)

  // Custom Alert State
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [errorTitle, setErrorTitle] = useState('Error')

  // Delete Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletionItem, setDeletionItem] = useState<DebtCredit | null>(null)


  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    setError,
    watch,
    setValue
  } = useForm<DebtCreditForm>()

  const watchType = watch('type', 'debt')

  // --- Voice Input Logic Hook ---
  const { isListening, voiceData, startListening, resetVoiceData, error: voiceError } = useVoiceTransaction()

  useEffect(() => {
    if (voiceData) {
      setValue('amount', voiceData.amount || undefined as any)
      setValue('person_name', voiceData.person_name)
      setValue('type', voiceData.type)
      setValue('description', voiceData.description)
      // Set default due date
      setValue('due_date', format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'))

      resetVoiceData() // Clear data after setting
    }
  }, [voiceData, setValue, resetVoiceData])

  useEffect(() => {
    if (voiceError) {
      alert(voiceError)
    }
  }, [voiceError])


  useEffect(() => {
    if (user) {
      fetchDebtsCredits()
      fetchAccounts()
    }
  }, [user])

  const fetchDebtsCredits = async (skipCache = false) => {
    try {
      const cacheKey = `debts_credits:${user?.id}`

      if (!skipCache) {
        const cached = getCached<DebtCredit[]>(cacheKey)
        if (cached) {
          setDebtsCredits(cached)
          setLoading(false)
          return
        }
      }

      // Perform cleanup of old settled items (only on fresh fetch)
      const { data: oldSettled } = await supabase
        .from('debts_credits')
        .select('id, settlement_transaction_id, is_settled, transactions!settlement_transaction_id(created_at)')
        .eq('user_id', user?.id)
        .eq('is_settled', true)

      if (oldSettled) {
        const now = new Date()
        const idsToDelete = oldSettled
          .filter((item: any) => {
            if (!item.transactions?.created_at) return false
            const settledDate = new Date(item.transactions.created_at)
            const diffInHours = (now.getTime() - settledDate.getTime()) / (1000 * 60 * 60)
            return diffInHours > 24
          })
          .map((item: any) => item.id)

        if (idsToDelete.length > 0) {
          await supabase
            .from('debts_credits')
            .delete()
            .in('id', idsToDelete)
        }
      }

      // Then fetch clean list
      const { data, error } = await supabase
        .from('debts_credits')
        .select('*, settlement_transaction:transactions!settlement_transaction_id(created_at)')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      if (data) {
        setDebtsCredits(data)
        setCached(cacheKey, data)
      }
    } catch (error) {
      console.error('Error fetching debts/credits:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAccounts = async () => {
    try {
      const cacheKey = `accounts:${user?.id}`
      const cached = getCached<Account[]>(cacheKey)
      if (cached) {
        setAccounts(cached)
        return
      }

      const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', user?.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (error) throw error
      if (data) {
        setAccounts(data)
        setCached(cacheKey, data)
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    }
  }

  const invalidateDebtsCaches = () => {
    invalidateCacheByPrefix('debts_credits:')
    invalidateCacheByPrefix('dashboard:')
    invalidateCacheByPrefix('accounts:')
    invalidateCacheByPrefix('transactions:')
    invalidateCacheByPrefix('transactions_list:')
  }

  const onSubmit = async (data: DebtCreditForm) => {
    setIsSubmitting(true)

    try {
      // Check for duplicates
      const { data: existingDebt } = await supabase
        .from('debts_credits')
        .select('id')
        .eq('user_id', user?.id)
        .eq('person_name', data.person_name)
        .eq('amount', data.amount)
        .eq('type', data.type)
        .eq('description', data.description)
        .eq('is_settled', false)
        .single()

      if (existingDebt && !editingItem) {
        setDuplicateMessage('This transaction already exists and has not been added again.')
        setTimeout(() => setDuplicateMessage(''), 5000)
        return
      }

      if (editingItem) {
        const { error } = await supabase
          .from('debts_credits')
          .update({
            person_name: data.person_name,
            amount: data.amount,
            type: data.type,
            description: data.description,
            due_date: data.due_date || null,
            phone_number: data.phone_number || null
          })
          .eq('id', editingItem.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('debts_credits')
          .insert({
            user_id: user?.id,
            person_name: data.person_name,
            amount: data.amount,
            type: data.type,
            description: data.description,
            due_date: data.due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            phone_number: data.phone_number || null,
            is_settled: false
          })

        if (error) throw error
      }

      invalidateDebtsCaches()
      await fetchDebtsCredits()
      handleCloseModal()
    } catch (error: any) {
      // Fallback: If phone_number column doesn't exist yet, retry without it
      if (error.message?.includes('phone_number') || error.message?.includes('schema cache')) {
        try {
          if (editingItem) {
            const { error: retryError } = await supabase
              .from('debts_credits')
              .update({
                person_name: data.person_name,
                amount: data.amount,
                type: data.type,
                description: data.description,
                due_date: data.due_date || null
              })
              .eq('id', editingItem.id)
            if (retryError) throw retryError
          } else {
            const { error: retryError } = await supabase
              .from('debts_credits')
              .insert({
                user_id: user?.id,
                person_name: data.person_name,
                amount: data.amount,
                type: data.type,
                description: data.description,
                due_date: data.due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                is_settled: false
              })
            if (retryError) throw retryError
          }
          invalidateDebtsCaches()
          await fetchDebtsCredits()
          handleCloseModal()
          setErrorMessage('Note: Phone number was not saved because the database needs to be updated. Other details were saved.')
          setErrorTitle('Database Update Required')
          setShowErrorModal(true)
          return
        } catch (retryErr) {
          // If it still fails, show original error
        }
      }
      setError('root', { message: error.message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const initiateSettlement = async (id: string, currentStatus: boolean) => {
    if (processingIds.has(id)) return

    const item = debtsCredits.find(dc => dc.id === id)
    if (!item) return

    if (currentStatus) {
      await toggleSettled(id, currentStatus, null)
    } else {
      if (accounts.length > 1) {
        setPendingSettlementItem(item)
        setShowAccountSelection(true)
      } else if (accounts.length === 1) {
        await toggleSettled(id, currentStatus, accounts[0].id)
      } else {
        alert('No active accounts found. Please create an account first.')
      }
    }
  }

  const toggleSettled = async (id: string, currentStatus: boolean, accountId: string | null) => {
    if (processingIds.has(id)) return
    setProcessingIds(prev => new Set(prev).add(id))

    try {
      const item = debtsCredits.find(dc => dc.id === id)
      if (!item) {
        setProcessingIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        return
      }

      if (!currentStatus) {
        // Marking as settled
        let settlementAccount: Account | null = null

        if (accountId) {
          settlementAccount = accounts.find(acc => acc.id === accountId) || null
        } else {
          settlementAccount = accounts[0] || null
        }

        if (!settlementAccount) {
          alert('No account found. Please create an account first.')
          return
        }

        const transactionType = item.type === 'credit' ? 'income' : 'expense'

        if (transactionType === 'expense' && settlementAccount.balance < item.amount) {
          setErrorMessage(`Insufficient funds in ${settlementAccount.name}.\n\nAvailable: ${formatCurrency(settlementAccount.balance)}\nRequired: ${formatCurrency(item.amount)}`)
          setErrorTitle('Insufficient Funds')
          setShowErrorModal(true)
          setProcessingIds(prev => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          return
        }

        const description = item.type === 'credit'
          ? `Received payment from ${item.person_name}: ${item.description}`
          : `Paid ${item.person_name}: ${item.description}`

        const { data: newTransaction, error: txError } = await supabase
          .from('transactions')
          .insert({
            user_id: user?.id,
            account_id: settlementAccount.id,
            amount: item.amount,
            type: transactionType,
            description: description,
            category: 'Debt/Credit Settlement'
          })
          .select()
          .single()

        if (txError) throw txError

        const balanceChange = item.type === 'credit' ? item.amount : -item.amount
        const newBalance = settlementAccount.balance + balanceChange

        const { error: balanceError } = await supabase
          .from('accounts')
          .update({
            balance: newBalance
          })
          .eq('id', settlementAccount.id)

        if (balanceError) throw balanceError

        const { error: updateError } = await supabase
          .from('debts_credits')
          .update({
            is_settled: true,
            settlement_transaction_id: newTransaction.id,
            settlement_account_id: settlementAccount.id
          })
          .eq('id', id)

        if (updateError) throw updateError

      } else {
        // Marking as unsettled
        if (item.settlement_transaction_id) {
          const settlementAccount = accounts.find(acc => acc.id === item.settlement_account_id)

          if (settlementAccount) {
            const balanceChange = item.type === 'credit' ? -item.amount : item.amount
            const newBalance = settlementAccount.balance + balanceChange

            const { error: balanceError } = await supabase
              .from('accounts')
              .update({ balance: newBalance })
              .eq('id', settlementAccount.id)

            if (balanceError) throw balanceError
          }

          const { error: deleteError } = await supabase
            .from('transactions')
            .delete()
            .eq('id', item.settlement_transaction_id)

          if (deleteError) throw deleteError
        }

        const { error: updateError } = await supabase
          .from('debts_credits')
          .update({
            is_settled: false,
            settlement_transaction_id: null,
            settlement_account_id: null
          })
          .eq('id', id)

        if (updateError) throw updateError
      }

      invalidateDebtsCaches()
      await fetchDebtsCredits()
      await fetchAccounts()
    } catch (error: any) {
      console.error('Error updating settlement status:', error)
      alert(`Error: ${error.message || 'Failed to update settlement status'}`)
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleAccountSelection = async (accountId: string) => {
    if (pendingSettlementItem) {
      await toggleSettled(pendingSettlementItem.id, pendingSettlementItem.is_settled, accountId)
    }
    setShowAccountSelection(false)
    setPendingSettlementItem(null)
  }

  const deleteItem = async (id: string) => {
    const item = debtsCredits.find(d => d.id === id)
    if (item) {
      setDeletionItem(item)
      setShowDeleteModal(true)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletionItem) return
    const id = deletionItem.id
    if (processingIds.has(id)) return

    setProcessingIds(prev => new Set(prev).add(id))
    setShowDeleteModal(false)

    try {
      const { error } = await supabase
        .from('debts_credits')
        .delete()
        .eq('id', id)

      if (error) throw error
      invalidateDebtsCaches()
      await fetchDebtsCredits()
    } catch (error) {
      console.error('Error deleting item:', error)
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setDeletionItem(null)
    }
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingItem(null)
    reset()
  }

  const handleEditItem = (item: DebtCredit) => {
    setEditingItem(item)
    reset({
      person_name: item.person_name,
      amount: item.amount,
      type: item.type,
      description: item.description,
      due_date: item.due_date ? format(new Date(item.due_date), 'yyyy-MM-dd') : undefined,
      phone_number: item.phone_number || undefined
    })
    setShowModal(true)
  }

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const togglePersonExpansion = (personName: string) => {
    setExpandedPeople(prev => {
      const newSet = new Set(prev)
      if (newSet.has(personName)) {
        newSet.delete(personName)
      } else {
        newSet.add(personName)
      }
      return newSet
    })
  }

  // --- Grouping & Filtering Logic ---
  const getFilteredGroups = () => {
    // 1. Initial Filter (Search, Settled, Date)
    let filtered = debtsCredits.filter(item => {
      if (item.is_settled) return false // We handle settled separately now

      // Search
      const searchLower = searchQuery.toLowerCase()
      const matchesSearch = item.person_name.toLowerCase().includes(searchLower) ||
        item.description.toLowerCase().includes(searchLower)
      if (!matchesSearch) return false

      return true
    })

    // 2. Group by Person
    const groups: { [key: string]: PersonGroup } = {}
    filtered.forEach(item => {
      if (!groups[item.person_name]) {
        groups[item.person_name] = {
          person_name: item.person_name,
          items: [],
          total_debt: 0,
          total_credit: 0,
          net_amount: 0
        }
      }
      groups[item.person_name].items.push(item)
      if (item.type === 'debt') {
        groups[item.person_name].total_debt += item.amount
      } else {
        groups[item.person_name].total_credit += item.amount
      }
    })

    // 3. Calculate Net & Filter by Status
    let resultGroups = Object.values(groups).map(g => ({
      ...g,
      net_amount: g.total_credit - g.total_debt
    }))

    if (statusFilter === 'i_owe') {
      resultGroups = resultGroups.filter(g => g.net_amount < 0)
    } else if (statusFilter === 'owes_me') {
      resultGroups = resultGroups.filter(g => g.net_amount > 0)
    }

    return resultGroups
  }


  const personGroups = getFilteredGroups()
  const settledItems = debtsCredits.filter(item => item.is_settled)

  // Totals for summary cards (Global)
  const allDebts = debtsCredits.filter(item => item.type === 'debt' && !item.is_settled)
  const allCredits = debtsCredits.filter(item => item.type === 'credit' && !item.is_settled)
  const totalDebt = allDebts.reduce((sum, item) => sum + item.amount, 0)
  const totalCredit = allCredits.reduce((sum, item) => sum + item.amount, 0)


  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header: Title + Add Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Debts & Credits</h1>
          <PageGuide
            title="Debts & Credits"
            description="Track every penny. Record who owes you (Credits) and who you owe (Debts). Settle up easily when payments are made."
            tips={[
              "Use the 'Settle Up' feature to record payments.",
              "Keep track of informal loans with friends.",
              "Warning: Deleting an entry removes it permanently. Settle it to keep the history."
            ]}
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add
        </button>
      </div>

      {/* Desktop View - Colored Cards */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm">You Owe</p>
              <p className="text-2xl font-bold text-red-600 mt-1">
                {formatCurrency(totalDebt)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{allDebts.length} people</p>
            </div>
            <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-full">
              <Banknote className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm">Others Owe You</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {formatCurrency(totalCredit)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{allCredits.length} people</p>
            </div>
            <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-full">
              <Banknote className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 dark:text-gray-300 text-sm">Net Balance</p>
              <p className={`text-2xl font-bold mt-1 ${totalCredit - totalDebt >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                {formatCurrency(totalCredit - totalDebt)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {totalCredit >= totalDebt ? 'In your favor' : 'You owe more'}
              </p>
            </div>
            <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-full">
              <User className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile View - Light Colored Cards Layout */}
      <div className="sm:hidden">
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-center shadow-sm border border-red-100 dark:border-red-800">
            <div className="flex flex-col h-full">
              <p className="font-medium text-sm text-red-700 dark:text-red-300 flex items-center justify-center min-h-[2.5rem]">
                You Owe
              </p>
              <div className="flex-grow flex items-center justify-center my-1">
                <p className="text-xl font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(totalDebt)}
                </p>
              </div>
              <p className="text-xs text-red-500 dark:text-red-400 mt-auto">{allDebts.length} people</p>
            </div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/30 rounded-xl p-3 text-center shadow-sm border border-green-100 dark:border-green-800">
            <div className="flex flex-col h-full">
              <p className="font-medium text-sm text-green-700 dark:text-green-300 flex items-center justify-center min-h-[2.5rem]">
                Others Owe
              </p>
              <div className="flex-grow flex items-center justify-center my-1">
                <p className="text-xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(totalCredit)}
                </p>
              </div>
              <p className="text-xs text-green-500 dark:text-green-400 mt-auto">{allCredits.length} people</p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-center shadow-sm border border-blue-100 dark:border-blue-800">
            <div className="flex flex-col h-full">
              <p className="font-medium text-sm text-blue-700 dark:text-blue-300 flex items-center justify-center min-h-[2.5rem]">
                Net
              </p>
              <div className="flex-grow flex items-center justify-center my-1">
                <p className={`text-xl font-bold ${totalCredit - totalDebt >= 0
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-red-600 dark:text-red-400'
                  }`}>
                  {formatCurrency(totalCredit - totalDebt)}
                </p>
              </div>
              <p className="text-xs text-blue-500 dark:text-blue-400 mt-auto">
                {totalCredit >= totalDebt ? 'In favor' : 'You owe'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* --- Filter Controls Row --- */}
      <div className="flex items-center gap-3 relative z-20">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={handleSearch}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-colors"
          />
        </div>

        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowFilterDropdown(!showFilterDropdown)
            }}
            className="flex items-center justify-between w-[130px] px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors"
          >
            <span className="font-medium truncate">
              {statusFilter === 'all' ? 'All' : statusFilter === 'i_owe' ? 'I Owe' : 'Owes Me'}
            </span>
            <ChevronDown className="w-4 h-4 text-gray-500 ml-2" />
          </button>

          {showFilterDropdown && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowFilterDropdown(false)}
              ></div>
              <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 overflow-hidden">
                <div className="p-1">
                  {[
                    { value: 'all', label: 'All' },
                    { value: 'i_owe', label: 'I Owe' },
                    { value: 'owes_me', label: 'Owes Me' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setStatusFilter(option.value as any)
                        setShowFilterDropdown(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${statusFilter === option.value
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* --- Main List: Person Groups --- */}
      <div className="space-y-4">
        {personGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-full mb-3">
              <Search className="w-6 h-6 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">No items found</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1 max-w-xs">
              Try adjusting your filters.
            </p>
          </div>
        ) : (
          <>
            {personGroups.slice(0, visibleCount).map((group) => {
              const isExpanded = expandedPeople.has(group.person_name)
              const isDebt = group.net_amount < 0

              return (
                <div key={group.person_name} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                  {/* Parent Row */}
                  <div
                    onClick={() => togglePersonExpansion(group.person_name)}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold text-sm">
                        {group.person_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{group.person_name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.items.length} items</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className={`text-base font-bold ${isDebt ? 'text-red-600' : 'text-green-600'}`}>
                        {isDebt ? '-' : '+'}{formatCurrency(Math.abs(group.net_amount))}
                      </span>
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                    </div>
                  </div>

                  {/* Child Rows (Expanded) */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 dark:border-gray-700 bg-slate-50 dark:bg-slate-900/50">
                      {(expandedChildLists.has(group.person_name)
                        ? group.items
                        : group.items.slice(0, 5)
                      ).map((item) => (
                        <div key={item.id} className="flex flex-col sm:flex-row gap-4 p-4 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors">

                          {/* Left Side: Description & Date */}
                          <div className="flex-grow min-w-0">
                            <div className="flex items-start justify-between sm:justify-start gap-2 mb-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white whitespace-normal break-words leading-relaxed">
                                {item.description}
                              </p>
                              {item.due_date && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap shrink-0 pt-0.5">
                                  Due {format(new Date(item.due_date), 'MMM d')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${item.type === 'debt'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                }`}>
                                {item.type === 'debt' ? 'I Owe' : 'Owes Me'}
                              </span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(item.created_at), 'MMM d')}
                              </span>
                            </div>
                          </div>

                          {/* Right Side: Amount & Actions */}
                          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 sm:gap-2 shrink-0">
                            <span className={`text-base font-bold ${item.type === 'debt' ? 'text-red-500' : 'text-green-500'}`}>
                              {formatCurrency(item.amount)}
                            </span>

                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleEditItem(item)
                                }}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  deleteItem(item.id)
                                }}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  initiateSettlement(item.id, item.is_settled)
                                }}
                                disabled={processingIds.has(item.id)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shadow-sm ${item.type === 'debt'
                                  ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300'
                                  }`}
                              >
                                {item.type === 'debt' ? 'Pay' : 'Receive'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* View All Toggle for Children */}
                      {group.items.length > 5 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const newSet = new Set(expandedChildLists)
                            if (newSet.has(group.person_name)) {
                              newSet.delete(group.person_name)
                            } else {
                              newSet.add(group.person_name)
                            }
                            setExpandedChildLists(newSet)
                          }}
                          className="w-full py-2 text-xs font-medium text-gray-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1"
                        >
                          {expandedChildLists.has(group.person_name) ? (
                            <>Show Less <ChevronUp className="w-3 h-3" /></>
                          ) : (
                            <>View all {group.items.length} transactions <ChevronDown className="w-3 h-3" /></>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Load More Button */}
            {visibleCount < personGroups.length && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => setVisibleCount(prev => prev + 15)}
                  className="px-6 py-2 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full shadow-sm border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Settled Items Section */}
      {settledItems.length > 0 && (
        <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
          <button
            onClick={() => setShowSettled(!showSettled)}
            className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {showSettled ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span className="text-sm font-medium">Show Recently Settled ({settledItems.length})</span>
          </button>

          {showSettled && (
            <div className="mt-4 space-y-2 opacity-75">
              {settledItems.map(item => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-gray-400 line-through">{item.person_name} - {item.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-400 line-through">{formatCurrency(item.amount)}</span>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* Account Selection Modal */}
      {showAccountSelection && pendingSettlementItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Select Account
              </h2>
              <button
                onClick={() => {
                  setShowAccountSelection(false)
                  setPendingSettlementItem(null)
                  setProcessingIds(prev => {
                    const next = new Set(prev)
                    next.delete(pendingSettlementItem.id)
                    return next
                  })
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-300">
                {pendingSettlementItem.type === 'credit'
                  ? `Select the account where you received payment from ${pendingSettlementItem.person_name}:`
                  : `Select the account from which you paid ${pendingSettlementItem.person_name}:`}
              </p>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {accounts.map((account) => (
                  <button
                    key={account.id}
                    onClick={() => handleAccountSelection(account.id)}
                    className="w-full p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Wallet className="w-5 h-5 text-gray-400" />
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white">{account.name}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Balance: {formatCurrency(account.balance)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {accounts.length === 0 && (
                <p className="text-center text-gray-500 dark:text-gray-400 py-4">
                  No active accounts found. Please create an account first.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Voice Assistant Overlay - Kept improvements */}
      {isListening && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="relative">
              <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
              <div className="relative bg-green-100 dark:bg-green-900/30 p-4 rounded-full">
                <Mic className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h3 className="mt-6 text-xl font-bold text-gray-900 dark:text-white">Listening...</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400 text-center max-w-xs text-sm">
              Try saying: <br />
              <span className="font-medium text-green-600 dark:text-green-400 block mt-2">"Owe John 500 for lunch"</span>
              <span className="text-xs text-gray-400 block my-1">or</span>
              <span className="font-medium text-green-600 dark:text-green-400">"Mike owes me 200"</span>
            </p>
            <button
              onClick={resetVoiceData}
              className="mt-8 px-6 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md overflow-visible">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingItem ? 'Edit Entry' : 'Add Debt/Credit'}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startListening}
                  className={`p-2 rounded-lg transition-colors ${isListening
                    ? 'bg-red-100 text-red-600 animate-pulse'
                    : 'hover:bg-green-50 text-green-600 dark:text-green-400 dark:hover:bg-green-900/20'
                    }`}
                  title="Auto-fill with Voice"
                >
                  <Mic className={`w-5 h-5 ${isListening ? 'animate-bounce' : ''}`} />
                </button>
                <button
                  onClick={handleCloseModal}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {duplicateMessage && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <p className="text-yellow-700 dark:text-yellow-400 text-sm">{duplicateMessage}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Person Name
                </label>
                <input
                  {...register('person_name', { required: 'Person name is required' })}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="John Doe"
                />
                {errors.person_name && (
                  <p className="text-red-500 text-sm mt-1">{errors.person_name.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setValue('type', 'debt')}
                  className={`flex items-center justify-center p-3 rounded-lg border-2 transition-all ${watchType === 'debt'
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                    : 'border-transparent bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                >
                  <input
                    type="radio"
                    value="debt"
                    className="hidden"
                    {...register('type')}
                  />
                  <span className="font-medium">I owe them</span>
                </button>
                <button
                  type="button"
                  onClick={() => setValue('type', 'credit')}
                  className={`flex items-center justify-center p-3 rounded-lg border-2 transition-all ${watchType === 'credit'
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                    : 'border-transparent bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}
                >
                  <input
                    type="radio"
                    value="credit"
                    className="hidden"
                    {...register('type')}
                  />
                  <span className="font-medium">They owe me</span>
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount (₹)
                </label>
                <input
                  {...register('amount', {
                    required: 'Amount is required',
                    min: { value: 0.01, message: 'Amount must be greater than 0' }
                  })}
                  type="number"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="1000"
                />
                {errors.amount && (
                  <p className="text-red-500 text-sm mt-1">{errors.amount.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Description
                </label>
                <input
                  {...register('description', { required: 'Description is required' })}
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Lunch money, loan, etc."
                />
                {errors.description && (
                  <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Due Date
                </label>
                <input
                  type="date"
                  value={watch('due_date') || format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')}
                  onChange={(e) => setValue('due_date', e.target.value)}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                {errors.due_date && (
                  <p className="text-red-500 text-sm mt-1">{errors.due_date.message}</p>
                )}
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Default: 7 days from today
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    <span>Phone Number (for WhatsApp)</span>
                  </div>
                </label>
                <input
                  {...register('phone_number')}
                  type="tel"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="+91 98765 43210"
                />
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Optional: Add phone to share reminders via WhatsApp
                </p>
              </div>

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
                  {isSubmitting
                    ? (editingItem ? 'Updating...' : 'Adding...')
                    : (editingItem ? 'Update' : 'Add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Item"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmText="Delete Item"
      />

      {/* Error Alert Modal */}
      <ConfirmModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        onConfirm={() => setShowErrorModal(false)}
        title={errorTitle}
        message={errorMessage}
        confirmText="OK"
        showCancel={false}
        type="warning"
      />
    </div>
  )
}