import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Skeleton, cn, formatRelativeDays } from '@autoservices/ui'
import type { AppNotification } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { IconBell } from './Icons.js'

/**
 * In-app notification centre (NOT-001, task brief §29).
 *
 * Database-backed, not ephemeral toasts: a reminder the user missed while away is still
 * there when they return.
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const unread = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => api.notifications.unreadCount(),
    // Polling keeps the badge honest without a websocket. 60s is frequent enough for
    // reminders, which are generated hourly at most.
    refetchInterval: 60_000,
  })

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.notifications.list({ limit: 30 }),
    enabled: open,
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] }),
    ])

  const markRead = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: refresh,
  })
  const markAllRead = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: refresh,
  })

  const count = unread.data?.count ?? 0

  function openNotification(n: AppNotification) {
    if (!n.readAt) markRead.mutate(n.id)
    setOpen(false)
    if (n.actionUrl) navigate(n.actionUrl)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        // 44px touch target, matching the shell's other header controls (UI_UX.md §8).
        className="relative flex size-11 shrink-0 items-center justify-center rounded-md text-content-secondary transition-colors hover:bg-surface-sunken hover:text-content-primary"
      >
        <IconBell className="size-[18px]" />
        {count > 0 && (
          <span
            className="absolute right-1 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-status-overdue px-1 text-[10px] font-semibold leading-4 text-white"
            aria-hidden="true"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="menu"
            aria-label="Notifications"
            className="absolute right-0 top-12 z-20 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-default bg-surface-overlay shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
              <span className="text-[13px] font-semibold">Notifications</span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  className="text-[12px] font-medium text-accent hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[26rem] overflow-y-auto">
              {list.isPending ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : list.error ? (
                <p className="px-3 py-6 text-center text-[13px] text-status-overdue">
                  Could not load notifications.
                </p>
              ) : list.data.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[13px] font-medium">You are all caught up</p>
                  <p className="mt-1 text-[12.5px] text-content-secondary">
                    Reminders about services, MOT and renewals will appear here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {list.data.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => openNotification(n)}
                        className={cn(
                          'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken',
                          !n.readAt && 'bg-accent-subtle/40',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1.5 size-1.5 shrink-0 rounded-full',
                            n.readAt ? 'bg-transparent' : 'bg-accent',
                          )}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{n.title}</span>
                          {n.body && (
                            <span className="mt-0.5 block text-[12.5px] text-content-secondary">
                              {n.body}
                            </span>
                          )}
                          <span className="mt-1 block text-[11.5px] text-content-tertiary">
                            {formatRelativeDays(daysSince(n.createdAt))}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-border-subtle p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setOpen(false)
                  navigate('/reminders')
                }}
              >
                View all reminders
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
