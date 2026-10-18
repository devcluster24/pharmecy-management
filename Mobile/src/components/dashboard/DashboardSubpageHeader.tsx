import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';

export default function DashboardSubpageHeader({
  subtitle,
  onBack,
}: {
  subtitle: string;
  onBack?: () => void;
}) {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#145642" />
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack ?? (() => router.back())}
          style={styles.backButton}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.brand}>Pharmacy Cluster</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go to Home"
          onPress={() => router.replace('/dashboard')}
          style={styles.homeButton}>
          <SymbolView
            name={{ ios: 'house.fill', android: 'home', web: 'home' }}
            size={19}
            tintColor="#fffdf7"
          />
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#286b55',
    backgroundColor: '#145642',
  },
  backButton: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: '#fffdf7',
    fontSize: 32,
    lineHeight: 36,
  },
  headerText: {
    flex: 1,
  },
  brand: {
    color: '#fffdf7',
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubtitle: {
    marginTop: 2,
    color: '#c2d8ce',
    fontSize: 10,
  },
  homeButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#5d927c',
    borderRadius: 12,
    backgroundColor: '#1c654d',
  },
});