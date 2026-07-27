'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import {
  PenLine,
  ListTodo,
  Image,
  Key,
  BarChart3,
  Settings,
  LayoutDashboard,
  Users,
  Box,
  Cpu,
  ShieldCheck,
  FileText,
  HeartPulse,
  LogOut,
} from 'lucide-react';

const userNavItems = [
  { href: '/studio', label: '工作台', icon: PenLine },
  { href: '/tasks', label: '任务', icon: ListTodo },
  { href: '/gallery', label: '图库', icon: Image },
  { href: '/api-keys', label: 'API 密钥', icon: Key },
  { href: '/usage', label: '使用量', icon: BarChart3 },
  { href: '/settings', label: '设置', icon: Settings },
];

const adminNavItems = [
  { href: '/admin', label: '总览', icon: LayoutDashboard },
  { href: '/admin/users', label: '用户', icon: Users },
  { href: '/admin/tasks', label: '任务', icon: ListTodo },
  { href: '/admin/assets', label: '资产', icon: Box },
  { href: '/admin/models', label: '模型', icon: Cpu },
  { href: '/admin/settings', label: '设置', icon: Settings },
  { href: '/admin/audit-logs', label: '审计', icon: ShieldCheck },
  { href: '/admin/health', label: '健康', icon: HeartPulse },
];

function SidebarContent({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { profile, signOut, isAdmin } = useAuth();

  return (
    <div className="flex flex-col h-full">
      {/* Logo - hidden on mobile (shown in top bar instead) */}
      <div className="hidden md:flex h-[var(--topbar-height)] items-center px-5 border-b border-[var(--color-border)]">
        <Link href="/studio" className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
          Image Relay Studio
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        <div className="space-y-0.5">
          {userNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-[var(--radius-sm)] transition-colors duration-150 md:py-1.5',
                pathname === item.href || pathname?.startsWith(item.href + '/')
                  ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
              )}
            >
              <span className="w-5 text-center flex items-center justify-center">
                <item.icon className="w-4 h-4" />
              </span>
              {item.label}
            </Link>
          ))}
        </div>

        {isAdmin && (
          <>
            <div className="my-3 border-t border-[var(--color-border)]" />
            <div className="mb-2 px-2.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-subtle)]">
              管理后台
            </div>
            <div className="space-y-0.5">
              {adminNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-[var(--radius-sm)] transition-colors duration-150 md:py-1.5',
                    pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href))
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
                  )}
                >
                  <span className="w-5 text-center flex items-center justify-center">
                <item.icon className="w-4 h-4" />
              </span>
                  {item.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </nav>

      {/* User info */}
      <div className="border-t border-[var(--color-border)] p-3 safe-area-bottom">
        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          <div className="w-7 h-7 rounded-full bg-[var(--color-surface-subtle)] flex items-center justify-center text-xs font-medium text-[var(--color-text-muted)]">
            {profile?.display_name?.[0] || profile?.email?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--color-text)] truncate">
              {profile?.display_name || profile?.email}
            </div>
            <div className="text-[10px] text-[var(--color-text-subtle)]">
              {isAdmin ? '管理员' : '用户'}
            </div>
          </div>
          <button
            onClick={signOut}
            className="tap-target text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-[var(--topbar-height)] bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between px-4 z-40 safe-area-top">
        <button
          onClick={() => setMobileOpen(true)}
          className="tap-target text-[var(--color-text)] hover:text-[var(--color-text-muted)]"
          aria-label="打开菜单"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        </button>
        <Link href="/studio" className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
          Image Relay Studio
        </Link>
        <div className="w-11" /> {/* Spacer for centering */}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-50 transition-opacity"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          'md:hidden fixed top-0 left-0 bottom-0 w-[280px] bg-[var(--color-surface)] z-50 flex flex-col transform transition-transform duration-200 ease-out safe-area-left',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Close button */}
        <div className="flex items-center justify-between h-[var(--topbar-height)] px-4 border-b border-[var(--color-border)]">
          <span className="text-sm font-semibold text-[var(--color-text)]">菜单</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="tap-target text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-label="关闭菜单"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l10 10M14 4L4 14" />
            </svg>
          </button>
        </div>
        <SidebarContent onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-[var(--sidebar-width)] bg-[var(--color-surface)] border-r border-[var(--color-border)] flex-col z-30">
        <SidebarContent />
      </aside>
    </>
  );
}
