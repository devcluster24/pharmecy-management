import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import DashboardSubpageHeader from '@/components/dashboard/DashboardSubpageHeader';
import ExpensesScreen from '@/components/dashboard/ExpensesScreen';

export default function ExpensesRoute() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#145642' }}>
      <DashboardSubpageHeader
        subtitle="Expenses"
        onBack={() => router.replace('/dashboard')}
      />
      <ExpensesScreen />
    </SafeAreaView>
  );
}
