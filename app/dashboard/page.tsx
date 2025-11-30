'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

interface GrowthMetrics {
  totalUsers: number;
  dau: number;
  mau: number;
  peakActiveHour: { hour: string; count: number } | null;
  paidUsers: number;
  recurringUsers: number;
  deploymentsSuccess: number;
  deploymentsFailed: number;
  publishedApps: number;
  avgFailsPerUser: number;
}

interface RevenueMetrics {
  dailyPayers: number;
  totalPayers: number;
  recurringPayers: number;
  totalApiCost: number;
  dailyApiCost: number;
  totalRevenue: number;
  dailyRevenue: number;
}

type TabType = 'growth' | 'revenue';

export default function DashboardPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState<TabType>('growth');
  const [growthMetrics, setGrowthMetrics] = useState<GrowthMetrics | null>(null);
  const [revenueMetrics, setRevenueMetrics] = useState<RevenueMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('dashboard_token');
    if (token) {
      verifyToken(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  const verifyToken = async (token: string) => {
    try {
      const res = await fetch('/api/dashboard/auth', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setIsAuthenticated(true);
      } else {
        localStorage.removeItem('dashboard_token');
      }
    } catch {
      localStorage.removeItem('dashboard_token');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);

    try {
      const res = await fetch('/api/dashboard/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('dashboard_token', data.token);
        setIsAuthenticated(true);
        toast.success('Welcome to the dashboard!');
      } else {
        toast.error(data.error || 'Login failed');
      }
    } catch {
      toast.error('Connection error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('dashboard_token');
    setIsAuthenticated(false);
    setGrowthMetrics(null);
    setRevenueMetrics(null);
  };

  const fetchMetrics = useCallback(async (tab: TabType) => {
    const token = localStorage.getItem('dashboard_token');
    if (!token) return;

    setMetricsLoading(true);
    try {
      const endpoint = tab === 'growth' ? '/api/dashboard/stats' : '/api/dashboard/revenue';
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        handleLogout();
        toast.error('Session expired. Please login again.');
        return;
      }

      const data = await res.json();
      if (data.success) {
        if (tab === 'growth') {
          setGrowthMetrics(data.metrics);
        } else {
          setRevenueMetrics(data.metrics);
        }
      }
    } catch {
      toast.error('Failed to fetch metrics');
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  // Fetch metrics when authenticated or tab changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchMetrics(activeTab);
    }
  }, [isAuthenticated, activeTab, fetchMetrics]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-[#1a1a2e] rounded-2xl p-8 shadow-2xl border border-[#2a2a4e]">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">Minidev Dashboard</h1>
              <p className="text-gray-400">Admin access only</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0f0f1a] border border-[#2a2a4e] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                  placeholder="admin@minidev.fun"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0f0f1a] border border-[#2a2a4e] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-[#1a1a2e] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-white"></span>
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      {/* Header */}
      <header className="bg-[#1a1a2e] border-b border-[#2a2a4e] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-white">Minidev Dashboard</h1>
            <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs font-medium rounded">
              Admin
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-gray-400 hover:text-white hover:bg-[#2a2a4e] rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-[#1a1a2e] p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('growth')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'growth'
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-[#2a2a4e]'
            }`}
          >
            Growth Metrics
          </button>
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-6 py-3 rounded-lg font-medium transition-all ${
              activeTab === 'revenue'
                ? 'bg-orange-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-[#2a2a4e]'
            }`}
          >
            Revenue & Costs
          </button>
        </div>

        {metricsLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500"></div>
          </div>
        ) : activeTab === 'growth' ? (
          <GrowthTab metrics={growthMetrics} />
        ) : (
          <RevenueTab metrics={revenueMetrics} />
        )}
      </main>
    </div>
  );
}

function GrowthTab({ metrics }: { metrics: GrowthMetrics | null }) {
  if (!metrics) {
    return (
      <div className="text-center py-20 text-gray-400">
        No data available
      </div>
    );
  }

  const cards = [
    { label: 'Total Users', value: metrics.totalUsers, icon: '👥', color: 'from-blue-500 to-blue-600' },
    { label: 'Daily Active Users', value: metrics.dau, icon: '📊', color: 'from-green-500 to-green-600' },
    { label: 'Monthly Active Users', value: metrics.mau, icon: '📈', color: 'from-purple-500 to-purple-600' },
    { label: 'Peak Active/Hour', value: metrics.peakActiveHour?.count || 0, icon: '⚡', color: 'from-yellow-500 to-yellow-600', subtitle: metrics.peakActiveHour?.hour ? new Date(metrics.peakActiveHour.hour).toLocaleString() : 'N/A' },
    { label: 'Paid Users', value: metrics.paidUsers, icon: '💳', color: 'from-pink-500 to-pink-600' },
    { label: 'Recurring Users', value: metrics.recurringUsers, icon: '🔄', color: 'from-cyan-500 to-cyan-600' },
    { label: 'Deployments Passed', value: metrics.deploymentsSuccess, icon: '✅', color: 'from-emerald-500 to-emerald-600' },
    { label: 'Deployments Failed', value: metrics.deploymentsFailed, icon: '❌', color: 'from-red-500 to-red-600' },
    { label: 'Published Apps', value: metrics.publishedApps, icon: '🚀', color: 'from-indigo-500 to-indigo-600' },
    { label: 'Avg Fails/User', value: metrics.avgFailsPerUser, icon: '📉', color: 'from-orange-500 to-orange-600' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {cards.map((card, index) => (
        <MetricCard key={index} {...card} />
      ))}
    </div>
  );
}

function RevenueTab({ metrics }: { metrics: RevenueMetrics | null }) {
  if (!metrics) {
    return (
      <div className="text-center py-20 text-gray-400">
        No data available
      </div>
    );
  }

  const cards = [
    { label: 'Daily Payers', value: metrics.dailyPayers, icon: '💵', color: 'from-green-500 to-green-600' },
    { label: 'Total Payers', value: metrics.totalPayers, icon: '👛', color: 'from-blue-500 to-blue-600' },
    { label: 'Recurring Payers', value: metrics.recurringPayers, icon: '🔁', color: 'from-purple-500 to-purple-600' },
    { label: 'Daily Revenue', value: `$${metrics.dailyRevenue.toFixed(2)}`, icon: '💰', color: 'from-emerald-500 to-emerald-600' },
    { label: 'Total Revenue', value: `$${metrics.totalRevenue.toFixed(2)}`, icon: '🏦', color: 'from-yellow-500 to-yellow-600' },
    { label: 'Daily API Cost', value: `$${metrics.dailyApiCost.toFixed(2)}`, icon: '📡', color: 'from-orange-500 to-orange-600' },
    { label: 'Total API Cost', value: `$${metrics.totalApiCost.toFixed(2)}`, icon: '💸', color: 'from-red-500 to-red-600' },
    { label: 'Daily Margin', value: `$${(metrics.dailyRevenue - metrics.dailyApiCost).toFixed(2)}`, icon: '📊', color: metrics.dailyRevenue - metrics.dailyApiCost >= 0 ? 'from-green-500 to-green-600' : 'from-red-500 to-red-600' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {cards.map((card, index) => (
        <MetricCard key={index} {...card} />
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  color,
  subtitle,
}: {
  label: string;
  value: number | string;
  icon: string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-[#1a1a2e] rounded-2xl p-6 border border-[#2a2a4e] hover:border-[#3a3a5e] transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-2xl`}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold text-white mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-gray-400 text-sm">{label}</div>
      {subtitle && (
        <div className="text-gray-500 text-xs mt-1">{subtitle}</div>
      )}
    </div>
  );
}

