import type { DashboardRole } from '@/providers/AuthProvider';

export function hasDashboardPageAccess(
  role: DashboardRole | null,
  permissions: Record<string, boolean>,
  page: string | readonly string[],
) {
  if (role === 'owner') return true;
  if (role !== 'staff') return false;
  const requiredPages = typeof page === 'string' ? [page] : page;
  return requiredPages.every((requiredPage) => permissions[requiredPage] === true);
}

export function hasAnyDashboardPageAccess(
  role: DashboardRole | null,
  permissions: Record<string, boolean>,
  pages: readonly string[],
) {
  if (role === 'owner') return true;
  if (role !== 'staff') return false;
  return pages.some((page) => permissions[page] === true);
}
