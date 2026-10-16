import DashboardTabScreen from '@/components/dashboard/DashboardTabScreen';
import OwnerHomeScreen from '@/components/dashboard/OwnerHomeScreen';
import { useAuth } from '@/providers/AuthProvider';

export default function DashboardScreen() {
  const { dashboardRole } = useAuth();

  if (dashboardRole === 'owner') {
    return <OwnerHomeScreen />;
  }

  return <DashboardTabScreen title="Welcome Dashboard" />;
}
