'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils/cn'
import {
  LayoutDashboard,
  BarChart3,
  Palette,
  AlertTriangle,
  Server,
  Layers,
  Activity,
  Briefcase,
  Sun,
  Moon,
  LogOut,
  FlaskConical,
} from 'lucide-react'

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/errors', label: 'Errors', icon: AlertTriangle },
  { href: '/infrastructure', label: 'Infrastructure', icon: Server },
  { href: '/monitor', label: 'Monitor', icon: Activity },
  { href: '/designer', label: 'Designer', icon: Palette },
  { href: '/design-sim', label: 'Design Sim', icon: FlaskConical },
  { href: '/batch', label: 'Batch Render', icon: Layers },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
]

export function Sidebar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { user, logOut } = useAuth()

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-lg font-bold">Renderer Dashboard</h1>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t p-4 space-y-2">
        {user && (
          <div className="flex items-center justify-between px-3 py-1">
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
            <button
              onClick={logOut}
              className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
          <span className="ml-4">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}
