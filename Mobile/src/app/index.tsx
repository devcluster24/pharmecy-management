import { Redirect } from 'expo-router';

import { useAuth } from '@/providers/AuthProvider';

export default function HomeScreen() {
  const { session, isLoading } = useAuth();

  if (isLoading) return null;
  return <Redirect href={session ? '/dashboard' : '/Auth/login'} />;
}
