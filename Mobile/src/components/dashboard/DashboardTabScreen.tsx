import { Text } from '@/providers/LanguageProvider';
import DashboardNotificationCenter from '@/components/dashboard/DashboardNotificationCenter';
import {
  StyleSheet,
  View
} from 'react-native';

export default function DashboardTabScreen({
  title,
  emptyMessage,
}: {
  title: string;
  emptyMessage?: string;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <DashboardNotificationCenter />
      </View>
      {emptyMessage ? <Text style={styles.emptyMessage}>{emptyMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#f2f4ef',
    paddingHorizontal: 20,
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    color: '#183c31',
    fontSize: 24,
    fontWeight: '700',
  },
  emptyMessage: {
    marginTop: 10,
    color: '#758078',
    fontSize: 14,
  },
});
