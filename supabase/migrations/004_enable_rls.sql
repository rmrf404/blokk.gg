-- Enable Row Level Security on all tables
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Public read access (leaderboard, match history)
CREATE POLICY "players_select" ON players FOR SELECT USING (true);
CREATE POLICY "matches_select" ON matches FOR SELECT USING (true);

-- No insert/update/delete for anon role — all writes go through
-- the service role key (PartyServer and Next.js server-side).
