import type { Id } from '@tournament-os/backend/convex/_generated/dataModel';
import {
  formatRecord,
  useLatestStandings,
  useMyCurrentMatch,
} from '@tournament-os/core';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tournamentId = (id ?? null) as Id<'tournaments'> | null;

  const current = useMyCurrentMatch(tournamentId);
  const standings = useLatestStandings(tournamentId);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: current?.tournament.name ?? 'Tournament',
          headerStyle: { backgroundColor: '#0b0b0f' },
          headerTintColor: '#fff',
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Current round</Text>
        <CurrentMatch current={current} />

        <Text style={[styles.sectionTitle, styles.sectionGap]}>Standings</Text>
        <Standings standings={standings} />
      </ScrollView>
    </SafeAreaView>
  );
}

function CurrentMatch({
  current,
}: {
  current: ReturnType<typeof useMyCurrentMatch>;
}) {
  if (current === undefined) {
    return <Text style={styles.muted}>Loading…</Text>;
  }

  switch (current.kind) {
    case 'not_started':
      return <Text style={styles.muted}>The tournament hasn't started yet.</Text>;
    case 'between_rounds':
      return (
        <Text style={styles.muted}>
          Round {current.round.roundNumber} is complete. Waiting for the next
          pairing.
        </Text>
      );
    case 'no_match':
      return (
        <Text style={styles.muted}>
          No pairing yet for round {current.round.roundNumber}.
        </Text>
      );
    case 'match':
      return (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            Round {current.round.roundNumber}
            {current.match.tableNumber != null
              ? ` · Table ${current.match.tableNumber}`
              : ''}
          </Text>
          <Text style={styles.cardTitle}>
            {current.me.isBye
              ? 'You have a bye'
              : `vs ${current.opponent?.name ?? 'TBD'}`}
          </Text>
          <Text style={styles.muted}>Status: {current.match.matchStatus}</Text>
        </View>
      );
  }
}

function Standings({
  standings,
}: {
  standings: ReturnType<typeof useLatestStandings>;
}) {
  if (standings === undefined) {
    return <Text style={styles.muted}>Loading…</Text>;
  }
  if (standings === null) {
    return <Text style={styles.muted}>No standings published yet.</Text>;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>
        After round {standings.roundNumber}
      </Text>
      {standings.rows.map((row) => (
        <View
          key={`${row.rank}-${row.name ?? 'anon'}`}
          style={[styles.row, row.isMe && styles.rowMe]}
        >
          <Text style={styles.rank}>{row.rank}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {row.name ?? 'Unknown player'}
          </Text>
          <Text style={styles.record}>
            {formatRecord(row.matchWins, row.matchLosses, row.matchDraws)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  content: { padding: 20, gap: 12 },
  sectionTitle: {
    color: '#8b8b96',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionGap: { marginTop: 12 },
  muted: { color: '#8b8b96', fontSize: 15 },
  card: { backgroundColor: '#16161d', borderRadius: 14, padding: 16, gap: 6 },
  cardLabel: { color: '#7c8cff', fontSize: 13, fontWeight: '600' },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  rowMe: {
    backgroundColor: '#1f2030',
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  rank: { color: '#8b8b96', fontSize: 15, width: 28 },
  name: { color: '#fff', fontSize: 15, flex: 1 },
  record: { color: '#cfcfd6', fontSize: 15, fontVariant: ['tabular-nums'] },
});
