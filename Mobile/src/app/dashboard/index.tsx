import DashboardTabScreen from '@/components/dashboard/DashboardTabScreen';
import OwnerHomeScreen from '@/components/dashboard/OwnerHomeScreen';
import StaffHomeScreen from '@/components/dashboard/StaffHomeScreen';
import { useAuth } from '@/providers/AuthProvider';

export default function DashboardScreen() {
  const { dashboardRole } = useAuth();

  if (dashboardRole === 'owner') {
    return <OwnerHomeScreen />;
  }
  if (dashboardRole === 'staff') {
    return <StaffHomeScreen />;
  }

  return <DashboardTabScreen title="Welcome Dashboard" />;
}
