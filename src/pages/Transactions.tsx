
import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { getCached, setCached, invalidateCacheByPrefix } from '../lib/cache'
import { useForm } from 'react-hook-form'
import { Plus, Trash2, X, Search, Download, FileText, Loader, ChevronDown, ChevronUp, Mic } from 'lucide-react'
import ConfirmModal from '../components/ConfirmModal'
import { useCurrency } from '../hooks/useCurrency'
import { format, subHours, isBefore, subMonths } from 'date-fns'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useDateFormat } from '../hooks/useDateFormat'
import SEO from '../components/SEO'
import PageGuide from '../components/PageGuide'
import CalendarView from '../components/CalendarView'

// --- Voice Recognition Types ---
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}



// Update Transaction interface to be compatible with Transfers
interface Transaction {
  id: string
  user_id: string
  amount: number
  type: 'income' | 'expense' | 'transfer'
  description: string
  category: string
  is_recurring: boolean
  recurring_frequency: string | null
  created_at: string
  account_id: string
  goal_id: string | null
  // For transfers
  from_account_id?: string
  to_account_id?: string
  accounts?: {
    id: string
    name: string
    color: string
    balance: number
  }
}

interface Account {
  id: string
  name: string
  color: string
  balance: number
}

interface Goal {
  id: string
  name: string
  current_amount: number
  target_amount: number
}

interface TransactionForm {
  account_id: string
  amount: number
  type: 'income' | 'expense' | 'transfer'
  description: string
  category: string
  is_recurring: boolean
  recurring_frequency: string
}

export default function Transactions() {
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>(() => {
    const saved = localStorage.getItem('transaction_view_mode')
    return saved === 'calendar' ? 'calendar' : 'list'
  })
  const { formatCurrency, currency } = useCurrency()
  const { formatDate } = useDateFormat()
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterAccount, setFilterAccount] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState(format(subMonths(new Date(), 12), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null)
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 15

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    setError
  } = useForm<TransactionForm>()

  const isRecurring = watch('is_recurring', false)

  // --- Voice Input Logic ---
  const [isListening, setIsListening] = useState(false)

  const parseVoiceCommand = (text: string) => {
    const lowerText = text.toLowerCase()
    let amount = 0
    let description = text
    let category = 'Other'
    let type: 'income' | 'expense' = 'expense'

    // 1. Extract Amount (Post-fix or mid)
    const amountMatch = text.match(/[\d,]+(\.\d{1,2})?/)
    if (amountMatch) {
      amount = parseFloat(amountMatch[0].replace(/,/g, ''))
    }

    // 2. Determine Type
    if (lowerText.includes('income') || lowerText.includes('earned') || lowerText.includes('salary') || lowerText.includes('received')) {
      type = 'income'
    }

    // 3. Category Mapping (Simple Keywords)
    const categoryMap: Record<string, string> = {
      'food': 'Food & Dining', 'lunch': 'Food & Dining', 'dinner': 'Food & Dining', 'breakfast': 'Food & Dining', 'swiggy': 'Food & Dining', 'zomato': 'Food & Dining', 'eat': 'Food & Dining',
      'taxi': 'Transportation', 'uber': 'Transportation', 'ola': 'Transportation', 'bus': 'Transportation', 'train': 'Transportation', 'fuel': 'Transportation', 'cab': 'Transportation',
      'shopping': 'Shopping', 'clothes': 'Shopping', 'amazon': 'Shopping', 'flipkart': 'Shopping', 'buy': 'Shopping',
      'grocery': 'Groceries', 'vegetables': 'Groceries', 'milk': 'Groceries',
      'bill': 'Bills & Utilities', 'electricity': 'Bills & Utilities', 'water': 'Bills & Utilities', 'wifi': 'Bills & Utilities',
      'movie': 'Entertainment', 'netflix': 'Entertainment',
      'medicine': 'Healthcare', 'doctor': 'Healthcare',
      'rent': 'Rent',
      'salary': 'Salary',
    }

    // Find first matching category
    for (const [key, cat] of Object.entries(categoryMap)) {
      if (lowerText.includes(key)) {
        category = cat
        break
      }
    }

    // 4. Clean Description (Capitalize first letter)
    return { amount, category, type, description: description.charAt(0).toUpperCase() + description.slice(1) }
  }

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice recognition is not supported in this browser.')
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      console.log('Voice Input:', transcript)

      const parsed = parseVoiceCommand(transcript)

      // Set values only
      setValue('amount', parsed.amount || undefined as any)
      setValue('description', parsed.description)
      setValue('category', parsed.category)
      setValue('type', parsed.type)

      if (accounts.length > 0) {
        setValue('account_id', accounts[0].id)
      }

      setIsListening(false)
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error)
      setIsListening(false)
    }

    recognition.onend = () => setIsListening(false)

    recognition.start()
  }

  // Debounce search term


  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm)
    }, 500)

    return () => clearTimeout(timer)
  }, [searchTerm])

  // Listen for view mode changes from Settings
  useEffect(() => {
    const handleViewModeChange = () => {
      const saved = localStorage.getItem('transaction_view_mode')
      setViewMode(saved === 'calendar' ? 'calendar' : 'list')
    }
    const w = globalThis.window as typeof globalThis.window
    w.addEventListener('storage', handleViewModeChange)
    // Also listen for custom event from same tab
    const customHandler = () => handleViewModeChange()
    w.addEventListener('settings:viewModeChange' as any, customHandler)
    return () => {
      w.removeEventListener('storage', handleViewModeChange)
      w.removeEventListener('settings:viewModeChange' as any, customHandler)
    }
  }, [])

  useEffect(() => {
    if (user) {
      fetchInitialData(true)
    }
  }, [user])

  // Reset pagination when filters change
  useEffect(() => {
    if (user) {
      fetchInitialData(false)
    }
  }, [debouncedSearchTerm, filterType, filterAccount, dateFrom, dateTo])

  const fetchInitialData = async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      setPage(1)

      const userId = user?.id
      if (!userId) return

      // --- 1. Supporting Data Caching (Accounts, Goals) ---
      const accountsCacheKey = `accounts:${userId}`
      let accountsData = getCached<Account[]>(accountsCacheKey)
      if (!accountsData) {
        const { data } = await supabase
          .from('accounts')
          .select('id, name, color, balance')
          .eq('user_id', userId)
          .eq('is_active', true)
        accountsData = data
        if (accountsData) setCached(accountsCacheKey, accountsData)
      }
      if (accountsData) setAccounts(accountsData)

      const goalsCacheKey = `goals:${userId}`
      let goalsData = getCached<Goal[]>(goalsCacheKey)
      if (!goalsData) {
        const { data } = await supabase
          .from('goals')
          .select('id, name, current_amount, target_amount')
          .eq('user_id', userId)
          .eq('is_active', true)
        goalsData = data
        if (goalsData) setCached(goalsCacheKey, goalsData)
      }
      if (goalsData) setGoals(goalsData)

      // --- 2. Main List Caching (Transactions & Transfers) ---
      // The cache key must include all primary filters that affect the initial fetch
      const listCacheKey = `transactions_list:${userId}:${dateFrom}:${dateTo}`
      interface CachedListData {
        transactions: any[]
        transfers: any[]
      }

      let transactionsData: any[] = []
      let transfersData: any[] = []

      const cachedList = getCached<CachedListData>(listCacheKey)

      if (cachedList) {
        transactionsData = cachedList.transactions
        transfersData = cachedList.transfers
      } else {
        // Fetch from Supabase
        const txQuery = supabase
          .from('transactions')
          .select(`*, accounts(id, name, color, balance)`)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .gte('created_at', dateFrom)
          .lte('created_at', dateTo + 'T23:59:59.999Z')

        const tfQuery = supabase
          .from('transfers')
          .select('*')
          .eq('user_id', userId)
          .gte('created_at', dateFrom)
          .lte('created_at', dateTo + 'T23:59:59.999Z')

        const [{ data: txResult, error: txError }, { data: tfResult, error: tfError }] = await Promise.all([
          txQuery,
          tfQuery
        ])

        if (txError) throw txError
        if (tfError) throw tfError

        transactionsData = txResult || []
        transfersData = tfResult || []

        setCached(listCacheKey, { transactions: transactionsData, transfers: transfersData })
      }

      // --- 3. Process & Merge Data ---
      let allItems: Transaction[] = [...transactionsData]

      if (transfersData) {
        const formattedTransfers = transfersData.map(transfer => {
          const fromAccount = accountsData?.find(a => a.id === transfer.from_account_id)
          const toAccount = accountsData?.find(a => a.id === transfer.to_account_id)

          return {
            ...transfer,
            type: 'transfer',
            category: 'Transfer',
            description: transfer.description || `Transfer from ${fromAccount?.name || 'Unknown'} to ${toAccount?.name || 'Unknown'}`,
            account_id: transfer.from_account_id,
            is_recurring: false,
            recurring_frequency: null,
            accounts: fromAccount
          }
        })
        allItems = [...allItems, ...formattedTransfers]
      }

      // Apply client-side filters (these don't require API calls)
      if (filterType !== 'all') {
        allItems = allItems.filter(item => item.type === filterType)
      }
      if (filterAccount !== 'all') {
        allItems = allItems.filter(item =>
          item.account_id === filterAccount ||
          item.from_account_id === filterAccount ||
          item.to_account_id === filterAccount
        )
      }
      if (debouncedSearchTerm) {
        const lowerSearch = debouncedSearchTerm.toLowerCase()
        allItems = allItems.filter(item =>
          item.description.toLowerCase().includes(lowerSearch) ||
          item.category.toLowerCase().includes(lowerSearch)
        )
      }

      // Sort by date desc
      allItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setAllTransactions(allItems)

      // Initialize visible transactions (pagination)
      const initialBatch = allItems.slice(0, pageSize)
      setTransactions(initialBatch)
      setHasMore(allItems.length > pageSize)

    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMoreTransactions = async () => {
    setLoadingMore(true)
    // Client-side pagination
    const nextPage = page + 1
    const nextBatch = allTransactions.slice(0, nextPage * pageSize)

    setTransactions(nextBatch)
    setPage(nextPage)
    setHasMore(allTransactions.length > nextBatch.length)
    setLoadingMore(false)
  }

  // Check if transaction is older than 6 hours
  const isTransactionOld = (transactionDate: string) => {
    const sixHoursAgo = subHours(new Date(), 6)
    const transactionDateObj = new Date(transactionDate)
    return isBefore(transactionDateObj, sixHoursAgo)
  }

  const onSubmit = async (data: TransactionForm) => {
    try {
      // Fetch current account balance first for both create and edit to ensure validation
      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('balance')
        .eq('id', data.account_id)
        .single()

      if (accountError) throw accountError

      const currentBalance = Number(accountData?.balance) || 0
      const transactionAmount = Number(data.amount)

      if (editingTransaction) {
        // Check if editing is allowed
        if (isTransactionOld(editingTransaction.created_at)) {
          setError('root', { message: 'Cannot edit transactions older than 1 day' })
          return
        }

        // Calculate what the balance would be if we undid the old transaction
        let revertedBalance = currentBalance
        if (editingTransaction.type === 'income') {
          revertedBalance -= editingTransaction.amount
        } else {
          revertedBalance += editingTransaction.amount
        }

        // Calculate new projected balance
        let projectedBalance = revertedBalance
        if (data.type === 'income') {
          projectedBalance += transactionAmount
        } else {
          projectedBalance -= transactionAmount
        }

        // Sufficient funds check
        if (projectedBalance < 0) {
          setError('root', { message: 'Insufficient balance for this transaction' })
          return
        }

        const { error } = await supabase
          .from('transactions')
          .update({
            account_id: data.account_id,
            amount: data.amount,
            type: data.type,
            description: data.description,
            category: data.category,
            is_recurring: data.is_recurring,
            recurring_frequency: data.is_recurring ? data.recurring_frequency : null
          })
          .eq('id', editingTransaction.id)

        if (error) throw error

        // Update account balance if changed
        if (projectedBalance !== currentBalance) {
          const { error: updateError } = await supabase
            .from('accounts')
            .update({ balance: projectedBalance })
            .eq('id', data.account_id)

          if (updateError) throw updateError
        }

      } else {
        // Calculate new balance
        const balanceChange = data.type === 'income' ? transactionAmount : -transactionAmount
        const newBalance = currentBalance + balanceChange

        if (newBalance < 0) {
          setError('root', { message: 'Insufficient balance for this transaction' })

          // If it's an expense that causes negative balance, show helpful message
          if (data.type === 'expense') {
            setError('amount', { message: `Max available: ${currentBalance} ` })
          }
          return
        }

        // Insert the transaction
        const { error: transactionError } = await supabase
          .from('transactions')
          .insert({
            user_id: user?.id,
            account_id: data.account_id,
            amount: transactionAmount,
            type: data.type,
            description: data.description,
            category: data.category,
            is_recurring: data.is_recurring,
            recurring_frequency: data.is_recurring ? data.recurring_frequency : null
          })

        if (transactionError) throw transactionError

        // Update account balance
        const { error: updateError } = await supabase
          .from('accounts')
          .update({ balance: newBalance })
          .eq('id', data.account_id)

        if (updateError) throw updateError
      }

      // Invalidate caches and refresh
      invalidateCacheByPrefix('transactions:')
      invalidateCacheByPrefix('dashboard:')
      invalidateCacheByPrefix('accounts:')
      await fetchInitialData()
      handleCloseModal()
    } catch (error: any) {
      setError('root', { message: error.message })
    }
  }

  const initiateDeleteTransaction = (transaction: Transaction) => {
    if (isTransactionOld(transaction.created_at)) {
      alert('Cannot delete transactions older than 6 hours')
      return
    }
    setTransactionToDelete(transaction)
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = async () => {
    if (!transactionToDelete) return

    try {
      setDeletingTransactionId(transactionToDelete.id)
      setShowDeleteModal(false)

      const { data: accountData, error: accountError } = await supabase
        .from('accounts')
        .select('balance')
        .eq('id', transactionToDelete.account_id)
        .single()

      if (accountError) throw accountError

      const currentBalance = Number(accountData?.balance) || 0
      const transactionAmount = Number(transactionToDelete.amount)

      // Handle goal transaction reversal
      if (transactionToDelete.goal_id) {
        try {
          const { data: goalData, error: goalFetchError } = await supabase
            .from('goals')
            .select('current_amount, name')
            .eq('id', transactionToDelete.goal_id)
            .single();

          if (goalFetchError) throw goalFetchError;

          const newGoalAmount = Math.max(0, goalData.current_amount - transactionAmount);

          const { error: goalUpdateError } = await supabase
            .from('goals')
            .update({ current_amount: newGoalAmount })
            .eq('id', transactionToDelete.goal_id);

          if (goalUpdateError) throw goalUpdateError;
        } catch (goalError) {
          console.error('Error updating goal:', goalError);
        }
      }

      const balanceChange = transactionToDelete.type === 'income' ? -transactionAmount : transactionAmount
      const newBalance = currentBalance + balanceChange

      const { error: deleteError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', transactionToDelete.id)

      if (deleteError) throw deleteError

      const { error: updateError } = await supabase
        .from('accounts')
        .update({ balance: newBalance })
        .eq('id', transactionToDelete.account_id)

      if (updateError) throw updateError

      invalidateCacheByPrefix('transactions:')
      invalidateCacheByPrefix('dashboard:')
      invalidateCacheByPrefix('accounts:')
      invalidateCacheByPrefix('goals:')
      await fetchInitialData()

    } catch (error: any) {
      console.error('Error deleting transaction:', error)
      alert(`Error deleting transaction: ${error.message} `)
    } finally {
      setDeletingTransactionId(null)
      setTransactionToDelete(null)
    }
  }



  const handleCloseModal = () => {
    setShowModal(false)
    setEditingTransaction(null)
    reset()
  }



  const toggleTransactionDetails = (transactionId: string) => {
    setExpandedTransactionId(expandedTransactionId === transactionId ? null : transactionId)
  }

  const exportToExcel = () => {
    // For export, we need to fetch all transactions
    const exportAllTransactions = async () => {
      try {
        let query = supabase
          .from('transactions')
          .select(`
  *,
  accounts(
    id,
    name,
    color,
    balance
  )
    `)
          .eq('user_id', user?.id)
          .order('created_at', { ascending: false })

        if (filterType !== 'all') {
          query = query.eq('type', filterType)
        }
        if (filterAccount !== 'all') {
          query = query.eq('account_id', filterAccount)
        }
        if (dateFrom) {
          query = query.gte('created_at', dateFrom)
        }
        if (dateTo) {
          query = query.lte('created_at', dateTo + 'T23:59:59.999Z')
        }
        if (debouncedSearchTerm) {
          query = query.or(`description.ilike.% ${debouncedSearchTerm}%, category.ilike.% ${debouncedSearchTerm}% `)
        }

        const { data: allTransactions, error } = await query

        if (error) throw error

        const exportData = allTransactions?.map(t => ({
          Date: formatDate(t.created_at),
          Description: t.description,
          Amount: t.amount,
          Type: t.type,
          Category: t.category,
          Account: t.accounts?.name || 'Unknown',
          Goal: t.goal_id ? 'Yes' : 'No'
        })) || []

        const ws = XLSX.utils.json_to_sheet(exportData)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Transactions')
        XLSX.writeFile(wb, `Traxos - Report - ${format(new Date(), 'yyyy-MM-dd')}.xlsx`)
      } catch (error) {
        console.error('Error exporting to Excel:', error)
        alert('Error exporting data. Please try again.')
      }
    }

    exportAllTransactions()
  }

  const exportToPDF = () => {
    const exportAllForPDF = async () => {
      try {
        let query = supabase
          .from('transactions')
          .select(`
            *,
            accounts(
              id,
              name,
              color,
              balance
            )
          `)
          .eq('user_id', user?.id)
          .order('created_at', { ascending: false })

        if (filterType !== 'all') {
          query = query.eq('type', filterType)
        }
        if (filterAccount !== 'all') {
          query = query.eq('account_id', filterAccount)
        }
        if (dateFrom) {
          query = query.gte('created_at', dateFrom)
        }
        if (dateTo) {
          query = query.lte('created_at', dateTo + 'T23:59:59.999Z')
        }
        if (debouncedSearchTerm) {
          query = query.or(`description.ilike.%${debouncedSearchTerm}%, category.ilike.%${debouncedSearchTerm}%`)
        }

        const { data: allTransactions, error } = await query

        if (error) throw error

        // Calculate Summary
        let totalIncome = 0
        let totalExpense = 0

        allTransactions?.forEach((t) => {
          if (t.type === 'income') {
            totalIncome += Number(t.amount)
          } else if (t.type === 'expense') {
            totalExpense += Number(t.amount)
          }
        })

        const balance = totalIncome - totalExpense

        // Initialize PDF
        const doc = new jsPDF()
        const pageWidth = doc.internal.pageSize.getWidth()
        const pageHeight = doc.internal.pageSize.getHeight()

        // --- Branding & Header ---
        // Green Banner
        doc.setFillColor(34, 197, 94) // Tailwind Green-500 (#22c55e)
        doc.rect(0, 0, pageWidth, 40, 'F')

        // Logo / Title
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(24)
        doc.setFont('helvetica', 'bold')
        doc.text('TRAXOS', 20, 25)

        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.text('Personal Finance Report', 20, 32)

        // Date Info (Right side of Banner)
        doc.text(`Generated: ${formatDate(new Date())}`, pageWidth - 20, 25, { align: 'right' })
        doc.text(`Transactions: ${allTransactions?.length || 0}`, pageWidth - 20, 32, { align: 'right' })

        // --- Summary Section ---
        let colY = 55
        // Card width calculation
        const margin = 20
        const gap = 10
        const availableWidth = pageWidth - (margin * 2)
        const cardWidth = (availableWidth - (gap * 2)) / 3

        // Helper to draw summary card
        const drawCard = (x: number, title: string, amount: number, color: [number, number, number]) => {
          // Card Background
          doc.setFillColor(249, 250, 251) // Gray-50
          doc.setDrawColor(229, 231, 235) // Gray-200
          doc.roundedRect(x, colY, cardWidth, 25, 3, 3, 'FD')

          // Title
          doc.setTextColor(107, 114, 128) // Gray-500
          doc.setFontSize(8)
          doc.setFont('helvetica', 'bold')
          doc.text(title.toUpperCase(), x + 5, colY + 8)

          // Amount
          doc.setTextColor(color[0], color[1], color[2])
          doc.setFontSize(12)
          doc.text(`INR ${amount.toFixed(2)}`, x + 5, colY + 18)
        }

        drawCard(margin, 'TOTAL INCOME', totalIncome, [22, 163, 74]) // Green-600
        drawCard(margin + cardWidth + gap, 'TOTAL EXPENSES', totalExpense, [220, 38, 38]) // Red-600
        drawCard(margin + (cardWidth + gap) * 2, 'NET BALANCE', balance, balance >= 0 ? [22, 163, 74] : [220, 38, 38])

        // --- Transactions Table ---
        const tableBody = allTransactions?.map(t => [
          formatDate(t.created_at),
          t.description || 'No description',
          t.category,
          t.type.toUpperCase(),
          t.accounts?.name || 'Unknown',
          t.amount.toFixed(2)
        ]) || []

        autoTable(doc, {
          startY: 90,
          head: [['Date', 'Description', 'Category', 'Type', 'Account', 'Amount']],
          body: tableBody,
          theme: 'grid',
          headStyles: {
            fillColor: [6, 78, 59], // Emerald-900 (Dark Green)
            textColor: [255, 255, 255],
            fontStyle: 'bold'
          },
          alternateRowStyles: {
            fillColor: [240, 253, 244] // Green-50
          },
          styles: {
            font: 'helvetica',
            fontSize: 9,
            cellPadding: 3
          },
          columnStyles: {
            5: { halign: 'right' } // Amount aligned right
          },
          didDrawPage: (data) => {
            // Footer on each page
            const pageCount = doc.getNumberOfPages()
            doc.setFontSize(8)
            doc.setTextColor(156, 163, 175) // Gray-400
            doc.text(
              `Generated by Traxos Finance - Page ${pageCount}`,
              data.settings.margin.left,
              pageHeight - 10
            )
          }
        })

        doc.save(`Traxos_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`)

      } catch (error) {
        console.error('Error exporting to PDF:', error)
        alert('Error exporting data. Please try again.')
      }
    }

    exportAllForPDF()
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3 sm:p-6">
      <SEO title="Transactions" description="Manage your income and expenses." />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h1>
            <PageGuide
              title="Transactions"
              description="Log income, expenses, and transfers. Use filters to find old records and export data."
              tips={[
                "Use filters to find specific entries.",
                "Export to PDF for tax season.",
                "Recurring transactions save time.",
                "Security: Transactions cannot be edited after 6 hours to prevent data manipulation."
              ]}
            />
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add
        </button>
      </div>



      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        {/* Mobile View */}
        <div className="block sm:hidden space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="all">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>

          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="all">All Accounts</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>

          {/* Date Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {/* Export Buttons */}
          <div className="flex gap-2">
            <button
              onClick={exportToExcel}
              className="flex items-center justify-center flex-1 px-3 py-2 text-sm bg-green-100 text-green-700 border border-green-200 rounded-lg hover:bg-green-200 transition-colors"
            >
              <Download className="w-4 h-4 mr-1" />
              Excel
            </button>
            <button
              onClick={exportToPDF}
              className="flex items-center justify-center flex-1 px-3 py-2 text-sm bg-red-100 text-red-700 border border-red-200 rounded-lg hover:bg-red-200 transition-colors"
            >
              <FileText className="w-4 h-4 mr-1" />
              PDF
            </button>
          </div>
        </div>

        {/* Desktop View */}
        <div className="hidden sm:flex flex-wrap items-center gap-4">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[120px]"
          >
            <option value="all">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>

          <select
            value={filterAccount}
            onChange={(e) => setFilterAccount(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[120px]"
          >
            <option value="all">All Accounts</option>
            {accounts.map(account => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[140px]"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white min-w-[140px]"
          />

          {/* Export Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={exportToExcel}
              className="flex items-center px-3 py-2 text-sm bg-green-100 text-green-700 border border-green-200 rounded-lg hover:bg-green-200 transition-colors"
            >
              <Download className="w-4 h-4 mr-1" />
              Excel
            </button>
            <button
              onClick={exportToPDF}
              className="flex items-center px-3 py-2 text-sm bg-red-100 text-red-700 border border-red-200 rounded-lg hover:bg-red-200 transition-colors"
            >
              <FileText className="w-4 h-4 mr-1" />
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* Transactions View - List or Calendar */}
      {viewMode === 'calendar' ? (
        // Calendar View
        <CalendarView
          transactions={allTransactions}
          formatCurrency={formatCurrency}
          formatDate={formatDate}
          goals={goals}
          setShowModal={setShowModal}
          initiateDeleteTransaction={initiateDeleteTransaction}
          isTransactionOld={isTransactionOld}
          deletingTransactionId={deletingTransactionId}
        />
      ) : (
        // List View
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            {transactions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">No transactions found</p>
                <button
                  onClick={() => setShowModal(true)}
                  className="mt-2 text-green-600 hover:text-green-700 font-medium"
                >
                  Add your first transaction
                </button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {transactions.map((transaction) => {
                    const isOld = isTransactionOld(transaction.created_at)
                    const isGoalTransaction = !!transaction.goal_id
                    const goal = isGoalTransaction ? goals.find(g => g.id === transaction.goal_id) : null
                    const isDeleting = deletingTransactionId === transaction.id
                    const isExpanded = expandedTransactionId === transaction.id

                    return (
                      <div key={transaction.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        {/* Mobile Layout */}
                        <div className="block sm:hidden">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center space-x-3 flex-1 min-w-0">
                              <div
                                className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                                style={{ backgroundColor: transaction.type === 'transfer' ? '#3B82F6' : (transaction.accounts?.color || '#9CA3AF') }}
                              />
                              <div className="flex-1 min-w-0">
                                <h3 className="font-medium text-gray-900 dark:text-white truncate">
                                  {transaction.description}
                                </h3>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {transaction.type === 'transfer' ? 'Transfer' : transaction.accounts?.name}
                                  </span>
                                  {isGoalTransaction && (
                                    <span className="flex items-center px-2 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-medium flex-shrink-0">
                                      {goal ? `Goal: ${goal.name} ` : 'Goal'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1 ml-2 flex-shrink-0">
                              {/* View Details Button */}
                              <button
                                onClick={() => toggleTransactionDetails(transaction.id)}
                                className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                                title="View details"
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>



                              {/* Delete Button */}
                              {!isOld && (
                                <button
                                  onClick={() => initiateDeleteTransaction(transaction)}
                                  disabled={isDeleting}
                                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                                  title="Delete transaction"
                                >
                                  {isDeleting ? (
                                    <Loader className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className="capitalize">{transaction.category}</span>
                                {transaction.is_recurring && (
                                  <span className="px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-medium">
                                    {transaction.recurring_frequency}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs">{formatDate(transaction.created_at)}</span>
                            </div>

                            <div className="text-right">
                              <p className={`font-semibold text-sm ${transaction.type === 'income' ? 'text-green-600' :
                                transaction.type === 'expense' ? 'text-red-600' : 'text-blue-600'
                                } `}>
                                {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}{formatCurrency(transaction.amount)}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{transaction.type}</p>
                            </div>
                          </div>

                          {/* Expanded Details for Mobile */}
                          {isExpanded && (
                            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-600 rounded-lg space-y-2">
                              <div className="grid grid-cols-2 gap-2 text-sm">

                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Created:</span>
                                  <p>{formatDate(transaction.created_at)}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Account:</span>
                                  <p>{transaction.type === 'transfer' ? 'Transfer' : transaction.accounts?.name}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Category:</span>
                                  <p>{transaction.category}</p>
                                </div>
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Description:</span>
                                  <p>{transaction.description}</p>
                                </div>
                                {transaction.is_recurring && (
                                  <div>
                                    <span className="text-gray-500 dark:text-gray-400">Recurring:</span>
                                    <p>{transaction.recurring_frequency}</p>
                                  </div>
                                )}
                                {isGoalTransaction && (
                                  <div>
                                    <span className="text-gray-500 dark:text-gray-400">Goal:</span>
                                    <p>{goal ? goal.name : 'Goal Contribution'}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Desktop Layout */}
                        <div className="hidden sm:flex items-center justify-between">
                          <div className="flex items-center space-x-4 flex-1">
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{ backgroundColor: transaction.type === 'transfer' ? '#3B82F6' : (transaction.accounts?.color || '#9CA3AF') }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <h3 className="font-medium text-gray-900 dark:text-white truncate">
                                  {transaction.description}
                                </h3>
                                {isGoalTransaction && (
                                  <span className="flex items-center px-2 py-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs font-medium flex-shrink-0">
                                    {goal ? `Goal: ${goal.name} ` : 'Goal Contribution'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400 mt-1">
                                <span className="truncate">{transaction.type === 'transfer' ? 'Transfer' : transaction.accounts?.name}</span>
                                <span className="truncate">{transaction.category}</span>
                                <span>{formatDate(transaction.created_at)}</span>
                                {transaction.is_recurring && (
                                  <span className="px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-lg text-xs font-medium flex-shrink-0">
                                    {transaction.recurring_frequency}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-4">
                            <div className="text-right">
                              <p className={`font-semibold ${transaction.type === 'income' ? 'text-green-600' : 'text-red-600'
                                } `}>
                                {transaction.type === 'income' ? '+' : '-'}{formatCurrency(transaction.amount)}
                              </p>
                              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{transaction.type}</p>
                            </div>

                            <div className="flex items-center space-x-2">
                              {/* View Details Button for Desktop */}
                              <button
                                onClick={() => toggleTransactionDetails(transaction.id)}
                                className="p-1 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                                title="View details"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>



                              {/* Delete Button */}
                              {!isOld && (
                                <button
                                  onClick={() => initiateDeleteTransaction(transaction)}
                                  disabled={isDeleting}
                                  className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                                  title="Delete transaction"
                                >
                                  {isDeleting ? (
                                    <Loader className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expanded Details for Desktop */}
                        {isExpanded && (
                          <div className="hidden sm:block mt-4 p-4 bg-gray-50 dark:bg-gray-600 rounded-lg">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">Created Date:</span>
                                <p className="mt-1">{formatDate(transaction.created_at)}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">Account:</span>
                                <p className="mt-1">{transaction.type === 'transfer' ? 'Transfer' : transaction.accounts?.name}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">Category:</span>
                                <p className="mt-1">{transaction.category}</p>
                              </div>
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">Description:</span>
                                <p className="mt-1">{transaction.description}</p>
                              </div>
                              {transaction.is_recurring && (
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Recurring:</span>
                                  <p className="mt-1 capitalize">{transaction.recurring_frequency}</p>
                                </div>
                              )}
                              {isGoalTransaction && (
                                <div>
                                  <span className="text-gray-500 dark:text-gray-400">Goal:</span>
                                  <p className="mt-1">{goal ? goal.name : 'Goal Contribution'}</p>
                                </div>
                              )}
                              <div>
                                <span className="text-gray-500 dark:text-gray-400">Status:</span>
                                <p className="mt-1">{isOld ? 'Archived' : 'Active'}</p>
                              </div>
                            </div>
                            <div className="flex space-x-2 mt-4">
                              <button
                                onClick={() => toggleTransactionDetails(transaction.id)}
                                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                              >
                                Close Details
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Load More Button */}
                {/* Load More Button moved outside */}
              </>
            )}
          </div>

          {hasMore && viewMode === 'list' && (
            <div className="flex justify-center pb-4">
              <button
                onClick={loadMoreTransactions}
                disabled={loadingMore}
                className="group relative inline-flex items-center justify-center px-4 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 transition-all duration-200 bg-white dark:bg-gray-800 border border-green-200 dark:border-green-800/50 rounded-full hover:border-green-600 dark:hover:border-green-500 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <div className="flex items-center justify-center">
                    <Loader className="w-4 h-4 animate-spin mr-2" />
                    Loading...
                  </div>
                ) : (
                  <>
                    <span className="mr-2">Load More ({pageSize} more)</span>
                    <ChevronDown className="w-4 h-4 transition-transform group-hover:translate-y-1" />
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* Voice Assistant Overlay */}
      {isListening && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="relative">
              <div className="absolute inset-0 bg-green-500 rounded-full animate-ping opacity-75"></div>
              <div className="relative bg-green-100 dark:bg-green-900/30 p-4 rounded-full">
                <Mic className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <h3 className="mt-6 text-xl font-semibold text-gray-900 dark:text-white">Listening...</h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400 text-center max-w-xs">
              Try saying: <br />
              <span className="font-medium text-green-600 dark:text-green-400">"Lunch 500"</span> or <span className="font-medium text-green-600 dark:text-green-400">"Taxi 200"</span>
            </p>
            <button
              onClick={() => setIsListening(false)}
              className="mt-6 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account
                </label>
                <select
                  {...register('account_id', { required: 'Account is required' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">Select an account</option>
                  {accounts.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
                {errors.account_id && (
                  <p className="text-red-500 text-sm mt-1">{errors.account_id.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Type
                </label>
                <select
                  {...register('type')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Amount ({currency})
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
                  placeholder="e.g., Grocery shopping"
                />
                {errors.description && (
                  <p className="text-red-500 text-sm mt-1">{errors.description.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Category
                </label>
                <select
                  {...register('category')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="Food & Dining">Food & Dining</option>
                  <option value="Transportation">Transportation</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Entertainment">Entertainment</option>
                  <option value="Bills & Utilities">Bills & Utilities</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Education">Education</option>
                  <option value="Travel">Travel</option>
                  <option value="Groceries">Groceries</option>
                  <option value="Rent">Rent</option>
                  <option value="Insurance">Insurance</option>
                  <option value="Investment">Investment</option>
                  <option value="Salary">Salary</option>
                  <option value="Business">Business</option>
                  <option value="Gifts">Gifts</option>
                  <option value="Personal Care">Personal Care</option>
                  <option value="Home & Garden">Home & Garden</option>
                  <option value="Sports & Fitness">Sports & Fitness</option>
                  <option value="Technology">Technology</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="flex items-center">
                <input
                  {...register('is_recurring')}
                  type="checkbox"
                  className="w-4 h-4 text-green-600 bg-gray-100 border-gray-300 rounded focus:ring-green-500"
                />
                <label className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Recurring Transaction
                </label>
              </div>

              {isRecurring && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Frequency
                  </label>
                  <select
                    {...register('recurring_frequency')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              )}

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
                  {isSubmitting ? 'Saving...' : (editingTransaction ? 'Update' : 'Add')}
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
        title="Delete Transaction"
        message="Are you sure you want to delete this transaction? This cannot be undone."
        confirmText="Delete Transaction"
      />
    </div>
  )
}