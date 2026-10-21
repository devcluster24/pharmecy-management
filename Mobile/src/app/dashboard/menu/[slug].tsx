import { useLocalSearchParams } from 'expo-router';

import ManagementMenuScreen, {
  getManagementMenuTitle,
} from '@/components/dashboard/ManagementMenuScreen';

export default function ManagementMenuPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const title = getManagementMenuTitle(slug);

  return <ManagementMenuScreen activeSlug={slug} pageTitle={title} />;
}
