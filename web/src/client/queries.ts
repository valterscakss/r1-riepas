'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from './api';
import type { StatsView } from '@/domain/spots';
import type { Task } from '@/domain/types';
import type { SetCard } from '@/domain/records';
import type { PricingConfig } from '@/domain/pricing';

export const useStats = (enabled = true) =>
  useQuery({ queryKey: ['stats'], queryFn: () => api<StatsView>('/api/stats'), enabled });

/** Open warehouse jobs. Polled every 20 s: it drives the sidebar badge and new-job alerts. */
export const useOpenTasks = () =>
  useQuery({ queryKey: ['tasks', 'open'], queryFn: () => api<{ tasks: Task[]; open: number }>('/api/tasks?status=open'), refetchInterval: 20_000 });

export const usePending = (enabled = true) =>
  useQuery({ queryKey: ['pending'], queryFn: () => api<{ count: number; pending: SetCard[] }>('/api/pending'), enabled });

export const usePricing = (enabled = true) =>
  useQuery({ queryKey: ['pricing'], queryFn: () => api<{ pricing: PricingConfig; defaults: PricingConfig }>('/api/pricing'), enabled, staleTime: 60_000 });

/** After any change, everything on screen reloads — the data set is small. */
export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries(), [qc]);
}
