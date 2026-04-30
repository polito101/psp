"use client"

import { ArrowUpRight, ArrowDownRight, CreditCard, TrendingUp, DollarSign, Users } from "lucide-react"

const transactions = [
  { id: "TXN-8294", amount: "+$2,450.00", status: "Completed", time: "2 min ago", type: "incoming" },
  { id: "TXN-8293", amount: "+$890.50", status: "Completed", time: "5 min ago", type: "incoming" },
  { id: "TXN-8292", amount: "-$150.00", status: "Refunded", time: "12 min ago", type: "outgoing" },
  { id: "TXN-8291", amount: "+$3,200.00", status: "Completed", time: "18 min ago", type: "incoming" },
]

const stats = [
  { label: "Total Volume", value: "$1.2M", change: "+12.5%", icon: DollarSign, positive: true },
  { label: "Transactions", value: "8,429", change: "+8.2%", icon: CreditCard, positive: true },
  { label: "Success Rate", value: "99.7%", change: "+0.3%", icon: TrendingUp, positive: true },
  { label: "Active Users", value: "2,847", change: "+15.1%", icon: Users, positive: true },
]

export function DashboardSection() {
  return (
    <section id="platform" className="relative py-24 lg:py-32 overflow-hidden">
      {/* Background glows */}
      <div className="absolute top-1/4 left-0 w-[500px] h-[500px] rounded-full bg-[#5b6ef7]/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-0 w-[400px] h-[400px] rounded-full bg-[#00d4c8]/8 blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-sm font-semibold text-brand-gradient uppercase tracking-widest">Platform</span>
          <h2 className="mt-4 text-3xl lg:text-4xl font-bold text-white tracking-tight text-balance">
            Powerful dashboard. Real-time insights.
          </h2>
          <p className="mt-4 text-base text-[#8b8baa] leading-relaxed">
            Monitor transactions, analyze performance, and manage your entire payment 
            operation from a single, intuitive interface.
          </p>
        </div>

        {/* Dashboard mockup */}
        <div className="relative">
          {/* Outer glow */}
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#5b6ef7]/20 via-[#c936e8]/10 to-[#00d4c8]/10 blur-xl" />
          
          {/* Dashboard container */}
          <div className="relative rounded-3xl border border-white/10 bg-[#0c0c14]/90 backdrop-blur-xl overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="text-xs text-[#8b8baa]">dashboard.finara.online</div>
              <div className="w-16" />
            </div>

            {/* Dashboard content */}
            <div className="p-6 lg:p-8">
              {/* Stats row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {stats.map((stat) => (
                  <div key={stat.label} className="p-4 rounded-xl bg-white/[0.03] border border-white/8">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#5b6ef7]/15">
                        <stat.icon className="w-4 h-4 text-[#5b6ef7]" />
                      </div>
                      <div className={`flex items-center gap-0.5 text-xs font-medium ${stat.positive ? "text-[#00d4c8]" : "text-red-400"}`}>
                        {stat.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {stat.change}
                      </div>
                    </div>
                    <div className="text-xl font-bold text-white">{stat.value}</div>
                    <div className="text-xs text-[#8b8baa] mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Chart area + Transactions */}
              <div className="grid lg:grid-cols-5 gap-6">
                {/* Chart placeholder */}
                <div className="lg:col-span-3 p-5 rounded-xl bg-white/[0.03] border border-white/8">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold text-white">Transaction Volume</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#8b8baa]">Last 7 days</span>
                    </div>
                  </div>
                  {/* Simple chart visualization */}
                  <div className="h-40 flex items-end justify-between gap-2">
                    {[35, 52, 48, 70, 65, 85, 78].map((height, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-2">
                        <div 
                          className="w-full rounded-t-md bg-gradient-to-t from-[#5b6ef7] to-[#00d4c8]"
                          style={{ height: `${height}%` }}
                        />
                        <span className="text-[10px] text-[#8b8baa]">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent transactions */}
                <div className="lg:col-span-2 p-5 rounded-xl bg-white/[0.03] border border-white/8">
                  <h4 className="text-sm font-semibold text-white mb-4">Recent Transactions</h4>
                  <div className="flex flex-col gap-3">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div>
                          <div className="text-xs font-medium text-white">{tx.id}</div>
                          <div className="text-[10px] text-[#8b8baa]">{tx.time}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-semibold ${tx.type === "incoming" ? "text-[#00d4c8]" : "text-[#f97316]"}`}>
                            {tx.amount}
                          </div>
                          <div className="text-[10px] text-[#8b8baa]">{tx.status}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
