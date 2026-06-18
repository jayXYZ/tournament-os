import { useAuth } from '@clerk/expo';
import { AuthView, UserButton } from '@clerk/expo/native';
import { api } from '@tournament-os/backend/convex/_generated/api';
import { useQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  // `treatPendingAsSignedOut: false` keeps users with pending session tasks
  // (e.g. MFA) from being bounced back to the signed-out view.
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);

  // Player's active tournaments. `undefined` while loading (Convex convention).
  const tournaments = useQuery(
    api.tournaments.registrations.listMyTournaments,
    isSignedIn ? {} : 'skip',
  );

  if (!isLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.signedOut}>
          <Text style={styles.brand}>Tournament OS</Text>
          <Text style={styles.tagline}>
            Sign in to follow your matches and standings live.
          </Text>
          <Pressable style={styles.button} onPress={() => setAuthOpen(true)}>
            <Text style={styles.buttonText}>Sign in</Text>
          </Pressable>
        </View>

        <Modal
          visible={authOpen}
          presentationStyle="pageSheet"
          animationType="slide"
          onRequestClose={() => setAuthOpen(false)}
        >
          <AuthView onDismiss={() => setAuthOpen(false)} />
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Your tournaments</Text>
          <Text style={styles.subtitle}>Active events you're registered for</Text>
        </View>
        <UserButton />
      </View>

      {tournaments === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(item) => item.tournament._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No active tournaments</Text>
              <Text style={styles.emptyBody}>
                When you register for an event it'll show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: '/tournament/[id]',
                  params: { id: item.tournament._id },
                })
              }
            >
              <Text style={styles.cardTitle}>{item.tournament.name}</Text>
              {item.organizationName ? (
                <Text style={styles.cardOrg}>{item.organizationName}</Text>
              ) : null}
              <Text style={styles.cardStatus}>
                {item.tournament.status === 'in_progress'
                  ? 'In progress'
                  : 'Upcoming'}
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0b0f',
  },
  signedOut: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  brand: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
  },
  tagline: {
    color: '#8b8b96',
    fontSize: 16,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#5b6bff',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
  },
  subtitle: {
    color: '#8b8b96',
    fontSize: 14,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#16161d',
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  cardOrg: {
    color: '#8b8b96',
    fontSize: 14,
  },
  cardStatus: {
    color: '#7c8cff',
    fontSize: 13,
    marginTop: 4,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  emptyBody: {
    color: '#8b8b96',
    fontSize: 14,
    textAlign: 'center',
  },
});
