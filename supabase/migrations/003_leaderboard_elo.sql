-- Add ELO to weekly leaderboard RPC functions

CREATE OR REPLACE FUNCTION weekly_leaderboard(result_limit INTEGER DEFAULT 100)
RETURNS TABLE (
  player_id UUID,
  x_handle TEXT,
  x_avatar TEXT,
  display_name TEXT,
  wins BIGINT,
  losses BIGINT,
  total_games BIGINT,
  win_rate NUMERIC,
  elo INTEGER
)
LANGUAGE sql STABLE
AS $$
  WITH week_bounds AS (
    SELECT
      date_trunc('week', now() AT TIME ZONE 'UTC') AS week_start,
      date_trunc('week', now() AT TIME ZONE 'UTC') + INTERVAL '7 days' AS week_end
  ),
  auth_matches AS (
    SELECT id, player1_id, player2_id, winner_id
    FROM matches, week_bounds
    WHERE player1_type = 'auth'
      AND player2_type = 'auth'
      AND created_at >= week_bounds.week_start
      AND created_at < week_bounds.week_end
  ),
  per_player AS (
    SELECT player1_id AS pid,
           CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END AS won,
           CASE WHEN winner_id != player1_id THEN 1 ELSE 0 END AS lost
    FROM auth_matches
    UNION ALL
    SELECT player2_id AS pid,
           CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END AS won,
           CASE WHEN winner_id != player2_id THEN 1 ELSE 0 END AS lost
    FROM auth_matches
  ),
  agg AS (
    SELECT pid,
           SUM(won)::BIGINT AS wins,
           SUM(lost)::BIGINT AS losses,
           COUNT(*)::BIGINT AS total_games,
           ROUND(SUM(won)::NUMERIC / NULLIF(COUNT(*), 0), 4) AS win_rate
    FROM per_player
    GROUP BY pid
  )
  SELECT
    agg.pid AS player_id,
    p.x_handle,
    p.x_avatar,
    p.display_name,
    agg.wins,
    agg.losses,
    agg.total_games,
    agg.win_rate,
    p.elo
  FROM agg
  JOIN players p ON p.id = agg.pid
  ORDER BY agg.wins DESC, agg.win_rate DESC
  LIMIT result_limit;
$$;

-- Get a single player's weekly rank and stats by x_id (with ELO)
CREATE OR REPLACE FUNCTION player_weekly_rank(target_x_id TEXT)
RETURNS TABLE (
  position BIGINT,
  player_id UUID,
  x_handle TEXT,
  x_avatar TEXT,
  display_name TEXT,
  wins BIGINT,
  losses BIGINT,
  total_games BIGINT,
  win_rate NUMERIC,
  elo INTEGER
)
LANGUAGE sql STABLE
AS $$
  WITH week_bounds AS (
    SELECT
      date_trunc('week', now() AT TIME ZONE 'UTC') AS week_start,
      date_trunc('week', now() AT TIME ZONE 'UTC') + INTERVAL '7 days' AS week_end
  ),
  auth_matches AS (
    SELECT m.player1_id, m.player2_id, m.winner_id
    FROM matches m, week_bounds
    WHERE m.player1_type = 'auth'
      AND m.player2_type = 'auth'
      AND m.created_at >= week_bounds.week_start
      AND m.created_at < week_bounds.week_end
  ),
  per_player AS (
    SELECT player1_id AS pid,
           CASE WHEN winner_id = player1_id THEN 1 ELSE 0 END AS won,
           CASE WHEN winner_id != player1_id THEN 1 ELSE 0 END AS lost
    FROM auth_matches
    UNION ALL
    SELECT player2_id AS pid,
           CASE WHEN winner_id = player2_id THEN 1 ELSE 0 END AS won,
           CASE WHEN winner_id != player2_id THEN 1 ELSE 0 END AS lost
    FROM auth_matches
  ),
  agg AS (
    SELECT pid,
           SUM(won)::BIGINT AS wins,
           SUM(lost)::BIGINT AS losses,
           COUNT(*)::BIGINT AS total_games,
           ROUND(SUM(won)::NUMERIC / NULLIF(COUNT(*), 0), 4) AS win_rate
    FROM per_player
    GROUP BY pid
  ),
  ranked AS (
    SELECT
      ROW_NUMBER() OVER (ORDER BY agg.wins DESC, agg.win_rate DESC) AS position,
      agg.*
    FROM agg
  )
  SELECT
    r.position,
    r.pid AS player_id,
    p.x_handle,
    p.x_avatar,
    p.display_name,
    r.wins,
    r.losses,
    r.total_games,
    r.win_rate,
    p.elo
  FROM ranked r
  JOIN players p ON p.id = r.pid
  WHERE p.x_id = target_x_id
  LIMIT 1;
$$;
