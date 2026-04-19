import { useState, useEffect, useRef } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import { supabase } from '../lib/supabase'
import { getCached, setCached } from '../lib/cache'
import { useAuth } from '../contexts/AuthContext'
import { useCurrency } from '../hooks/useCurrency'
import { TrendingUp, TrendingDown, DollarSign, Activity, Calendar } from 'lucide-react'
import {
  format,
  subDays,
  eachDayOfInterval,
  startOfToday,
  startOfYesterday,
  startOfWeek,
  startOfMonth,
  startOfYear,
  endOfToday,
  endOfYesterday,
  endOfWeek,
  endOfMonth,
  endOfYear,
  subMonths,
  subWeeks,
} from 'date-fns'
import SEO from '../components/SEO'
import PageGuide from '../components/PageGuide'

type TimeFilter = 'today' | 'yesterday' | 'week' | 'last_week' | 'month' | 'last_month' | 'year' | 'last_7_days' | 'last_30_days' | 'last_90_days'

export default function Analytics() {
  const { user } = useAuth()
  const { formatCurrency } = useCurrency()
  const [loading, setLoading] = useState(true)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('last_30_days')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Stats
  const [stats, setStats] = useState({
    income: 0,
    expenses: 0,
    savingsRate: 0,
    avgDailySpend: 0
  })

  // Chart Data
  const [trendData, setTrendData] = useState<any[]>([])
  const [categoryData, setCategoryData] = useState<any[]>([])

  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1']

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (user) {
      fetchData()
    }
  }, [user, timeFilter])

  const getDateRange = () => {
    const now = new Date()
    switch (timeFilter) {
      case 'today': return { start: startOfToday(), end: endOfToday() }
      case 'yesterday': return { start: startOfYesterday(), end: endOfYesterday() }
      case 'week': return { start: startOfWeek(now), end: endOfWeek(now) }
      case 'last_week': return { start: startOfWeek(subWeeks(now, 1)), end: endOfWeek(subWeeks(now, 1)) }
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) }
      case 'last_month': return { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)) }
      case 'year': return { start: startOfYear(now), end: endOfYear(now) }
      case 'last_7_days': return { start: subDays(now, 7), end: now }
      case 'last_30_days': return { start: subDays(now, 30), end: now }
      case 'last_90_days': return { start: subDays(now, 90), end: now }
      default: return { start: subDays(now, 30), end: now }
    }
  }

  const getFilterLabel = (filter: TimeFilter) => {
    const labels = {
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'This Week',
      last_week: 'Last Week',
      month: 'This Month',
      last_month: 'Last Month',
      year: 'This Year',
      last_7_days: 'Last 7 Days',
      last_30_days: 'Last 30 Days',
      last_90_days: 'Last 90 Days'
    }
    return labels[filter]
  }

  const fetchData = async (skipCache = false) => {
    setLoading(true)
    try {
      const { start, end } = getDateRange()
      const cacheKey = `analytics:${user?.id}:${timeFilter}`

      if (!skipCache) {
        const cached = getCached<any[]>(cacheKey)
        if (cached) {
          processData(cached, start, end)
          setLoading(false)
          return
        }
      }

      const { data: txData, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user?.id)
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: true })

      if (error) throw error

      if (txData) {
        setCached(cacheKey, txData)
        processData(txData, start, end)
      }

    } catch (error) {
      console.error('Error fetching analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const processData = (data: any[], start: Date, end: Date) => {
    // 1. Calculate General Stats
    const income = data.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount), 0)
    const expenses = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount), 0)
    const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0

    // Calculate days diff properly
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    const avgDailySpend = expenses / days

    setStats({
      income,
      expenses,
      savingsRate,
      avgDailySpend
    })

    // 2. Process Trend Data
    // For large ranges, creating every day might be too much, but for typical use it's fine.
    // However, for 'all time' or 'year', maybe group by month?
    // For now, let's stick to daily intervals if range < 90 days, else monthly?
    // Keeping it simple with daily for consistency with previous implementation, but guarding against massive arrays.

    // For large ranges, creating every day might be too much, but for typical use it's fine.
    // However, for 'all time' or 'year', maybe group by month?
    // For now, let's stick to daily intervals if range < 90 days, else monthly?
    // Keeping it simple with daily for consistency with previous implementation, but guarding against massive arrays.

    if (days > 365 * 5) {
      // Too long, just take data points as is? Or maybe restrict 'All Time' rendering logic.
      // For safety, let's limit intervals if it's huge. 
      // Actually eachDayOfInterval will throw if start/end are invalid or too far apart.
      // Let's rely on data present for "All Time" instead of filling gaps if it's huge.
      // But for visually nice charts, filling gaps is better.
      // Let's cap the interval generation to last 365 days if 'all' is selected, or handle it differently.
      // For simplicity in this refactor, let's assume standard ranges.
      // For 'all', we might just map transactions.
    }

    // Safe formatting for the chart
    try {
      const daysInterval = eachDayOfInterval({ start, end: end > new Date() ? new Date() : end })

      let runningBalance = 0
      const trends = daysInterval.map(day => {
        const dayStr = format(day, 'MMM d')
        const dayTx = data.filter(t => format(new Date(t.created_at), 'MMM d') === dayStr)
        const dayIncome = dayTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
        const dayExpense = dayTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

        runningBalance += (dayIncome - dayExpense)

        return {
          name: dayStr,
          balance: runningBalance,
          income: dayIncome,
          expense: dayExpense
        }
      })
      setTrendData(trends)
    } catch (e) {
      // Fallback for weird ranges
      setTrendData([])
    }

    // 3. Process Category Data
    const expenseTx = data.filter(t => t.type === 'expense')
    const categories: { [key: string]: number } = {}
    expenseTx.forEach(t => {
      const cat = t.category || 'Uncategorized'
      categories[cat] = (categories[cat] || 0) + Number(t.amount)
    })

    const catChartData = Object.entries(categories)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    setCategoryData(catChartData)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 md:p-8 p-4">
        <div className="animate-pulse space-y-8">
          {/* Header Skeleton */}
          <div className="flex justify-between items-center">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-32"></div>
          </div>

          {/* KPI Cards Skeleton */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 h-32 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-4"></div>
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-32"></div>
              </div>
            ))}
          </div>

          {/* Charts Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
            <div className="bg-white dark:bg-gray-800 h-[300px] rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-40 mb-6"></div>
              <div className="h-[200px] bg-gray-100 dark:bg-gray-700/50 rounded-xl"></div>
            </div>
            <div className="bg-white dark:bg-gray-800 h-[300px] rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
              <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-40 mb-6"></div>
              <div className="h-[200px] bg-gray-100 dark:bg-gray-700/50 rounded-xl"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 md:p-8 p-4 pb-24">
      <SEO title="Analytics" description="Deep dive into your financial data" />

      {/* Header & Filter */}
      <div className="flex flex-row justify-between items-center mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white bg-clip-text text-transparent bg-gradient-to-r from-green-600 to-blue-600">
              Analytics
            </h1>
            <PageGuide
              title="Analytics"
              description="Deep dive into your financial data. Analyze spending trends, income vs expenses, and category breakdowns."
              tips={["Check your 'Savings Rate' to gauge financial health.", "Use time filters to spot seasonal trends.", "Identify high-spending categories to cut costs."]}
            />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {getFilterLabel(timeFilter)} Overview
          </p>
        </div>

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className="flex items-center space-x-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors w-full sm:w-auto justify-between sm:justify-start"
          >
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {getFilterLabel(timeFilter)}
              </span>
            </div>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showFilterDropdown && (
            <div className="absolute right-0 mt-2 w-full md:w-56 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden">
              <div className="p-2 grid grid-cols-1 gap-1">
                {([
                  'today', 'yesterday',
                  'week', 'last_week',
                  'month', 'last_month',
                  'last_7_days', 'last_30_days', 'last_90_days',
                  'year'
                ] as TimeFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => {
                      setTimeFilter(filter)
                      setShowFilterDropdown(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${timeFilter === filter
                      ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                  >
                    {getFilterLabel(filter)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards - Mobile Optimized Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
        {[
          {
            label: 'Income',
            value: stats.income,
            icon: TrendingUp,
            color: 'text-green-600',
            bg: 'bg-green-50 dark:bg-green-900/20'
          },
          {
            label: 'Expenses',
            value: stats.expenses,
            icon: TrendingDown,
            color: 'text-red-600',
            bg: 'bg-red-50 dark:bg-red-900/20'
          },
          {
            label: 'Daily Avg',
            value: stats.avgDailySpend,
            icon: Activity,
            color: 'text-blue-600',
            bg: 'bg-blue-50 dark:bg-blue-900/20'
          },
          {
            label: 'Savings',
            value: stats.savingsRate,
            icon: DollarSign,
            color: 'text-purple-600',
            bg: 'bg-purple-50 dark:bg-purple-900/20',
            isPercent: true
          },
        ].map((item, idx) => (
          <div key={idx} className="bg-white dark:bg-gray-800 rounded-xl p-4 md:p-6 shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center md:order-2 ${item.bg}`}>
                <item.icon className={`w-4 h-4 md:w-5 md:h-5 ${item.color}`} />
              </div>
              <div className="md:order-1">
                <p className="text-xs md:text-sm font-medium text-gray-500 dark:text-gray-400">{item.label}</p>
                <p className={`text-lg md:text-2xl font-bold mt-1 ${item.color}`}>
                  {item.isPercent ? `${item.value.toFixed(1)}%` : formatCurrency(item.value)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8 mb-8">

        {/* Net Flow Trend */}
        <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-base md:text-lg font-bold text-gray-900 dark:text-white mb-4 md:mb-6">Net Flow Trend</h3>
          <div className="h-[250px] md:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.1} />
                <XAxis
                  dataKey="name"
                  stroke="#6B7280"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#6B7280"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => formatCurrency(value)}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(31, 41, 55, 0.95)',
                    borderColor: 'rgba(55, 65, 81, 1)',
                    borderRadius: '8px',
                    color: '#F3F4F6',
                    fontSize: '12px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#10B981"
                  fillOpacity={1}
                  fill="url(#colorBalance)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Income vs Expenses Bar Chart */}
        <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-base md:text-lg font-bold text-gray-900 dark:text-white mb-4 md:mb-6">Income vs Expenses</h3>
          <div className="h-[250px] md:h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.1} />
                <XAxis
                  dataKey="name"
                  stroke="#6B7280"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{
                    backgroundColor: 'rgba(31, 41, 55, 0.95)',
                    borderColor: 'rgba(55, 65, 81, 1)',
                    borderRadius: '8px',
                    color: '#F3F4F6',
                    fontSize: '12px'
                  }}
                />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                <Bar name="Income" dataKey="income" fill="#10B981" radius={[4, 4, 0, 0]} />
                <Bar name="Expense" dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Spending Distribution */}
        <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h3 className="text-base md:text-lg font-bold text-gray-900 dark:text-white mb-4 md:mb-6">Spending Distribution</h3>
          <div className="flex flex-col md:flex-row items-center justify-center">
            <div className="h-[250px] w-full md:w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(31, 41, 55, 0.95)',
                      borderColor: 'rgba(55, 65, 81, 1)',
                      borderRadius: '8px',
                      color: '#F3F4F6',
                      fontSize: '12px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full md:w-1/2 space-y-3 mt-4 md:mt-0">
              {categoryData.map((entry, index) => (
                <div key={index} className="flex items-center justify-between text-xs md:text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                    <span className="text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{entry.name}</span>
                  </div>
                  <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(entry.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Efficiency Gauge */}
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 md:p-6 rounded-2xl shadow-lg text-white flex flex-col justify-between">
          <div>
            <h3 className="text-lg md:text-xl font-bold mb-2">Financial Health Score</h3>
            <p className="text-indigo-100 text-xs md:text-sm">Based on your savings rate and spending habits.</p>
          </div>

          <div className="flex items-center justify-center my-6 md:my-8">
            <div className="relative w-32 h-32 md:w-40 md:h-40 flex items-center justify-center">
              <svg className="absolute w-full h-full transform -rotate-90">
                <circle
                  cx="50%"
                  cy="50%"
                  r="45%"
                  stroke="currentColor"
                  strokeWidth="12"
                  fill="transparent"
                  className="text-indigo-400 opacity-30"
                />
                <circle
                  cx="50%"
                  cy="50%"
                  r="45%"
                  stroke="white"
                  strokeWidth="12"
                  fill="transparent"
                  strokeDasharray={440} // Approx for radius 70. Responsive radius complicates this exact math but visually clean enough for now.
                  strokeDashoffset={440 - (440 * Math.min(Math.max(stats.savingsRate + 50, 0), 100)) / 100}
                  className="transition-all duration-1000 ease-out"
                  strokeLinecap="round"
                />
              </svg>
              <div className="text-center">
                <span className="text-3xl md:text-4xl font-bold">{Math.round(Math.min(Math.max(stats.savingsRate + 50, 0), 100))}</span>
                <span className="text-xs md:text-sm block text-indigo-100">/ 100</span>
              </div>
            </div>
          </div>

          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 md:p-4">
            <p className="text-xs md:text-sm font-medium">
              {stats.savingsRate > 20 ? "Excellent work! You're saving consistently." : "Try to reduce expenses to boost your score."}
            </p>
          </div>
        </div>

      </div>

    </div>
  )
}