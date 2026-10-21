import { Text } from '@/providers/LanguageProvider';
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
      <Text style={styles.title}>{title}</Text>
      {emptyMessage ? <Text style={styles.emptyMessage}>{emptyMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f2f4ef',
  },
  title: {
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
