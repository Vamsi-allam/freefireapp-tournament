// Supabase-first API: mirror the old function names but use Supabase tables, RPC, and realtime.
import { supabase } from '../supabaseClient';
// Normalize a local or ISO datetime string into an ISO UTC string for Postgres timestamptz
function toUTCISOString(dt) {
	if (!dt) return null;
	try {
		// If it's already a Date, convert directly
		if (dt instanceof Date) return dt.toISOString();
		// dt might be like 'YYYY-MM-DDTHH:mm' (from <input type="datetime-local">)
		// or already ISO (e.g., '...Z'). new Date() treats bare strings as local time.
		const d = new Date(dt);
		if (Number.isNaN(d.getTime())) return dt; // fallback: let server parse
		return d.toISOString(); // store as UTC to preserve intended local time display later
	} catch {
		return dt;
	}
}

function chunk(arr, size) {
 if (!Array.isArray(arr) || size <= 0) return [arr || []];
 const out = [];
 for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
 return out;
}

// Reference ID generator: REF_<timestamp-base36>_<random-6>
function generateRef(prefix = 'REF') {
 const ts = Date.now().toString(36).toUpperCase();
 const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
 return `${prefix}_${ts}${rand}`;
}

// Utility: get current user id
async function getUid() {
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error) throw error;
	if (!user) throw new Error('Not signed in');
	return user.id;
}
async function ensureSession() {
	try {
		const { data, error } = await supabase.auth.getSession();
		if (error) throw error;
		if (!data || !data.session || !data.session.access_token) {
			const err = new Error('Not authenticated');
			err.code = 'NOT_AUTHENTICATED';
			maybeEmitAuthError(err);
			throw err;
		}
		return data.session;
	} catch (e) {
		maybeEmitAuthError(e);
		throw e;
	}
}

// Utility: broadcast auth errors in a similar way as before (for UI snackbar hooks)
function emitAuthEvent(message) {
	try {
		window.dispatchEvent(
			new CustomEvent('app:unauthorized', {
				detail: { status: 401, isExpired: false, message },
			})
		);
	} catch {}
}

// Helper: detect and emit session/auth issues
function maybeEmitAuthError(err) {
	const msg = String(err?.message || err?.error_description || '');
	const code = String(err?.code || '');
	// Heuristics for expired/missing JWT or unauthorized
	const looksUnauthorized = /unauthorized|invalid(.+)?token|jwt|session|not\s*authenticated/i.test(msg) || code === 'PGRST301' || code === '401';
	if (looksUnauthorized) {
		emitAuthEvent('Your session has expired. Please sign in again.');
	}
}

// ============== Matches ==============
export async function createMatch(payload) {
	const { data, error } = await supabase
		.from('matches')
		.insert({
			title: payload.title,
			game: payload.game ?? 'Free Fire',
			match_type: (payload.matchType || payload.gameMode || 'SQUAD').toUpperCase(),
			entry_fee: Number(payload.entryFee ?? 0),
			// Convert local datetime to UTC ISO before storing in timestamptz
			scheduled_at: toUTCISOString(payload.scheduleDateTime ?? payload.scheduledAt) ?? null,
			map_name: payload.mapName ?? null,
			game_mode: (payload.gameMode || payload.matchType || 'SQUAD').toUpperCase(),
			rules: payload.rules ?? null,
			rounds: payload.rounds ?? null,
			status: 'OPEN',
		})
		.select()
		.single();
	if (error) throw error;
	return data;
}

export async function listMatches() {
	const { data, error } = await supabase
		.from('matches')
		.select('*')
		.order('scheduled_at', { ascending: true });
	if (error) throw error;
	const rows = (data || []).map(row => ({
		id: row.id,
		title: row.title,
		game: row.game,
		matchType: row.match_type,
		entryFee: Number(row.entry_fee || 0),
		scheduledAt: row.scheduled_at,
		mapName: row.map_name,
		gameMode: row.game_mode,
		rules: row.rules,
		rounds: row.rounds,
		status: row.status,
		roomId: row.room_id,
		roomPassword: row.room_password,
		credentialsSentAt: row.credentials_sent_at,
		createdAt: row.created_at,
	}));

	// Derive slots by type
	const slotsById = Object.fromEntries(rows.map(r => [r.id, computeSlots(r.matchType)]));
	// Fetch registration counts via RPC (with fallback)
	const counts = await getRegistrationCounts(Object.keys(slotsById));
	// Enrich with registeredTeams and prizePool
	return rows.map(r => {
		const registeredTeams = Number(counts[r.id] || 0);
		const slots = slotsById[r.id];
		const computedPool = computePrizePool(r.matchType, r.entryFee, registeredTeams);
		const prizePool = r.prize_pool != null ? Number(r.prize_pool) : computedPool;
		return { ...r, registeredTeams, slots, prizePool };
	});
}

export async function listUpcomingMatches() {
	const now = new Date().toISOString();
	const { data, error } = await supabase
		.from('matches')
		.select('*')
		.gte('scheduled_at', now)
		.order('scheduled_at', { ascending: true });
	if (error) throw error;
	const rows = (data || []).map(row => ({
		id: row.id,
		title: row.title,
		game: row.game,
		matchType: row.match_type,
		entryFee: Number(row.entry_fee || 0),
		scheduledAt: row.scheduled_at,
		mapName: row.map_name,
		gameMode: row.game_mode,
		rules: row.rules,
		rounds: row.rounds,
		status: row.status,
		roomId: row.room_id,
		roomPassword: row.room_password,
		credentialsSentAt: row.credentials_sent_at,
		createdAt: row.created_at,
	}));

	const slotsById = Object.fromEntries(rows.map(r => [r.id, computeSlots(r.matchType)]));
	const counts = await getRegistrationCounts(Object.keys(slotsById));
	return rows.map(r => {
		const registeredTeams = Number(counts[r.id] || 0);
		const slots = slotsById[r.id];
		const computedPool = computePrizePool(r.matchType, r.entryFee, registeredTeams);
		const prizePool = r.prize_pool != null ? Number(r.prize_pool) : computedPool;
		return { ...r, registeredTeams, slots, prizePool };
	});
}

// Helpers: slots & prize pool calculation
function computeSlots(matchType) {
	const t = String(matchType || '').toUpperCase();
	if (t === 'SOLO') return 48;
	if (t === 'DUO') return 24;
	if (t === 'SQUAD') return 12;
	if (t === 'CLASH_SQUAD') return 2;
	return 12; // default
}

function computePrizePool(matchType, entryFee, registeredTeams) {
	const t = String(matchType || '').toUpperCase();
	const rate = t === 'SOLO' ? 0.80 : t === 'CLASH_SQUAD' ? 0.85 : 0.90; // DUO & SQUAD 90%
	// Total collected = entryFee (per team) × number of confirmed teams
	const collected = Number(entryFee || 0) * Number(registeredTeams || 0);
	const pool = collected * rate;
	return Math.round(pool);
}

async function getRegistrationCounts(matchIds) {
	const result = {};
	if (!Array.isArray(matchIds) || matchIds.length === 0) return result;
	try {
		// Cast to text[] for RPC that compares via match_id::text
		const textIds = matchIds.map(String);
		const { data, error } = await supabase.rpc('get_registration_counts_for_matches', { p_match_ids: textIds });
		if (error) throw error;
		(data || []).forEach((r) => { result[String(r.match_id)] = Number(r.registered || r.count || 0); });
		return result;
	} catch (e) {
		// Fallback: per-match count (parallel but limited)
		await Promise.all(
			matchIds.map(async (id) => {
				try {
					const { count, error } = await supabase
						.from('registrations')
						.select('*', { count: 'exact', head: true })
						.eq('match_id', id)
						.eq('status', 'CONFIRMED');
					if (error) throw error;
					result[String(id)] = Number(count || 0);
				} catch {
					result[String(id)] = 0;
				}
			})
		);
		return result;
	}
}

export async function updateMatch(id, matchData) {
	const { data, error } = await supabase
		.from('matches')
		.update({
			title: matchData.title,
			match_type: matchData.matchType?.toUpperCase(),
			entry_fee: matchData.entryFee != null ? Number(matchData.entryFee) : undefined,
	// Ensure we store the correct instant: treat inputs as local and convert to UTC ISO
	scheduled_at: toUTCISOString(matchData.scheduleDateTime ?? matchData.scheduledAt),
			map_name: matchData.mapName,
			game_mode: matchData.gameMode?.toUpperCase(),
			rules: matchData.rules,
			rounds: matchData.rounds,
			status: matchData.status,
			room_id: matchData.roomId,
			room_password: matchData.roomPassword,
		})
		.eq('id', id)
		.select()
		.single();
	if (error) throw error;
	return data;
}

// Admin: cancel a match and refund entry fees to all confirmed registrations
export async function cancelMatchAndRefund(matchId, reason = 'Match cancelled') {
	const { data, error } = await supabase.rpc('cancel_match_and_refund', {
		p_match_id: matchId,
		p_reason: reason,
	});
	if (error) throw error;
	return data;
}

export async function deleteMatch(id) {
	const { error } = await supabase.from('matches').delete().eq('id', id);
	if (error) throw error;
	return { success: true };
}

export async function saveCredentials(id, roomId, roomPassword) {
	const { data, error } = await supabase
		.from('matches')
		.update({ room_id: roomId, room_password: roomPassword, credentials_sent_at: null })
		.eq('id', id)
		.select('id, room_id, room_password')
		.single();
	if (error) throw error;
	return data;
}

export async function sendCredentialsToPlayers(id) {
	// Optional: mark sent timestamp; emailing can be handled by an Edge Function/webhook later
	const { error } = await supabase
		.from('matches')
		.update({ credentials_sent_at: new Date().toISOString() })
		.eq('id', id);
	if (error) throw error;
	return 'Credentials marked as sent'; 
}

	// Real-time subscriptions
// Internal helper: create a realtime channel with basic error logging and cleanup
function subscribeTable({ channelName, table, filter, event = '*', schema = 'public' }, callback) {
	// If env is missing, skip creating channels to avoid spam and let UI fall back to polling

	const ch = supabase
		.channel(channelName)
		.on('postgres_changes', { event, schema, table, ...(filter ? { filter } : {}) }, callback)
		.subscribe((status) => {
			if (status === 'CHANNEL_ERROR') {
				//console.warn(`[realtime:${channelName}] channel error`);
			} else if (status === 'TIMED_OUT') {
				//console.warn(`[realtime:${channelName}] timed out; will retry automatically`);
			}
		});
	return () => { try { supabase.removeChannel(ch); } catch {} };
}

// Usage: const unsub = subscribeMatches((event) => { ... });
export function subscribeMatches(callback) {
	return subscribeTable({ channelName: 'realtime-matches', table: 'matches' }, callback);
}

// Overloaded usage:
//  - subscribeRegistrations(matchId, callback)
//  - subscribeRegistrations({ matchId?, userId?, event? }, callback)
export function subscribeRegistrations(matchIdOrOpts, callback) {
	let opts = { matchId: null, userId: null, event: '*' };
	if (typeof matchIdOrOpts === 'object' && matchIdOrOpts !== null) {
		opts = { ...opts, ...matchIdOrOpts };
	} else {
		opts.matchId = matchIdOrOpts;
	}
	let where = null;
	if (opts.matchId) where = `match_id=eq.${opts.matchId}`;
	if (opts.userId) where = where ? `${where}&user_id=eq.${opts.userId}` : `user_id=eq.${opts.userId}`;
	const name = `realtime-registrations-${opts.matchId || opts.userId || 'all'}`;
	return subscribeTable({ channelName: name, table: 'registrations', filter: where, event: opts.event }, callback);
}

export function subscribeResults(matchId, callback) {
	const filter = matchId ? `match_id=eq.${matchId}` : null;
	const name = `realtime-results-${matchId || 'all'}`;
	return subscribeTable({ channelName: name, table: 'match_results', filter }, callback);
}

// ============== Wallets ==============
export async function getWalletBalance() {
	const uid = await getUid();
	// Ensure a wallet row exists
	await supabase.from('wallets').upsert({ user_id: uid }).select();
	const { data, error } = await supabase
		.from('wallets')
		.select('balance, total_added, total_spent')
		.eq('user_id', uid)
		.single();
	if (error) throw error;
	return data;
}

export async function getTransactionHistory({ limit = 100, before, days = 10 } = {}) {
	const uid = await getUid();
	// Only last N days
	const sinceIso = new Date(Date.now() - Math.max(1, Number(days || 10)) * 24 * 60 * 60 * 1000).toISOString();
	let query = supabase
		.from('wallet_transactions')
		.select('id, amount, type, description, reference_id, created_at, meta')
		.eq('user_id', uid)
		.gte('created_at', sinceIso)
		.order('created_at', { ascending: false })
		.limit(Math.max(10, Math.min(500, Number(limit || 100))));

	if (before) {
		try {
			const ts = new Date(before).toISOString();
			query = query.lt('created_at', ts);
		} catch {}
	}

	const { data, error } = await query;
	if (error) throw error;

	// Map DB rows (snake_case, custom type) to UI-friendly shape
	return (data || []).map((row) => {
		// Normalize type to CREDIT/DEBIT for UI
		const rawType = String(row.type || '').toUpperCase();
		const type = (rawType === 'SPEND' || rawType === 'WITHDRAW') ? 'DEBIT' : (rawType === 'ADD' ? 'CREDIT' : rawType);

		// Prefer explicit values; fallback to meta-based derivations
		let description = row.description || '';
		let referenceId = row.reference_id || row.referenceId || '';

		if (!description && row.meta && typeof row.meta === 'object') {
			if (row.meta.reason === 'match_registration') {
				description = row.meta.match_title
					? `Tournament Registration - ${row.meta.match_title}`
					: 'Tournament Registration';
			} else if (row.meta.reason === 'withdrawal') {
				description = 'Withdrawal';
			} else if (row.meta.reason === 'prize_credit') {
				description = 'Prize Credit';
			} else if (row.meta.reason === 'refund') {
				description = 'Refund';
			}
		}

		if (!referenceId && row.meta && typeof row.meta === 'object') {
			if (row.meta.reason === 'match_registration' && (row.meta.match_id || row.meta.registration_id)) {
				referenceId = `TRN_${row.meta.match_id || 'M'}_${row.meta.registration_id || 'R'}`;
			} else if (row.meta.reason === 'withdrawal' && row.meta.request_id) {
				referenceId = `WREQ_${row.meta.request_id}`;
			} else if (row.meta.reason === 'add_money' && (row.meta.reference_id || row.meta.ref)) {
				referenceId = String(row.meta.reference_id || row.meta.ref);
			} else if ((row.meta.reference_id || row.meta.ref)) {
				referenceId = String(row.meta.reference_id || row.meta.ref);
			} else if (row.meta.reason === 'refund' && row.meta.match_id) {
				referenceId = `REF_${row.meta.match_id}`;
			} else if (row.meta.reason === 'prize_credit' && row.meta.match_id) {
				referenceId = `PRIZE_${row.meta.match_id}`;
			}
		}

		return {
			id: row.id,
			amount: Number(row.amount || 0),
			type,
			description,
			referenceId: referenceId ? String(referenceId) : '',
			createdAt: row.created_at || row.createdAt,
			// expose raw for any advanced UI needs
			meta: row.meta || null,
		};
	});
}

export async function addMoney(amount) {
	const amt = Number(amount);
	if (!amt || amt <= 0) throw new Error('Amount must be positive');
	const { data, error } = await supabase.rpc('add_money', { p_amount: amt });
	if (error) throw error;
	return data;
}

export async function withdrawMoney(amount) {
	const amt = Number(amount);
	if (!amt || amt <= 0) throw new Error('Amount must be positive');
	const { data, error } = await supabase.rpc('withdraw_money', { p_amount: amt });
	if (error) throw error;
	return data;
}

// OTP-based withdrawal
export async function initiateWithdrawal(amount, withdrawalMethod, details) {
	const payload = {
		p_amount: Number(amount),
		p_method: String(withdrawalMethod || 'upi').toLowerCase(),
		p_details: details || {},
	};
	const { data, error } = await supabase.rpc('initiate_withdrawal', payload);
	if (error) throw error;
	// Expect backend to return at least request_id and optionally reference_id
	if (data && typeof data === 'object') {
		return {
			request_id: data.request_id ?? data.id ?? null,
			reference_id: data.reference_id ?? null,
			...data,
		};
	}
	return data; // { request_id }
}

export async function verifyWithdrawalOtp(otpCode) {
	const { data, error } = await supabase.rpc('verify_withdrawal_otp', { p_otp: String(otpCode) });
	if (error) throw error;
	// Bubble up any reference id echoed by backend
	if (data && typeof data === 'object') {
		const payload = { ...data, reference_id: data.reference_id ?? data.ref ?? null };
		// Fire-and-forget: alert admin that withdrawal OTP was verified
		try {
			await supabase.functions.invoke('send-admin-alert', {
				method: 'POST',
				body: { eventType: 'WITHDRAWAL_OTP_VERIFIED', withdrawal: payload },
			});
		} catch (e) { /* non-blocking */ }
		return payload;
	}
	return data;
}

// ===== OTP via Supabase Edge Functions (email) =====
// Requests a 6-digit OTP to be sent to the current user's email. Optionally override email & purpose.
export async function requestOtpEmail({ purpose = 'WITHDRAWAL', email, withdrawalId } = {}) {
	const { data, error } = await supabase.functions.invoke('send-otp', {
		method: 'POST',
	body: { purpose, email, withdrawalId },
	});
	if (error) throw error;
	return data; // { ok: true, expiresAt }
}

// Verifies an OTP code against server-stored hash; marks it used on success.
export async function verifyOtpCode({ otp, purpose = 'WITHDRAWAL', email, withdrawalId }) {
	const { data, error } = await supabase.functions.invoke('verify-otp', {
		method: 'POST',
	body: { otp, purpose, email, withdrawalId },
	});
	if (error) throw error;
	return data; // { ok: true }
}

// ============== Results & Prizes ==============
export async function getMatchParticipants(matchId) {
	await ensureSession();
	// Fetch registrations for the match
	const { data: regs, error: rErr } = await supabase
		.from('registrations')
		.select('*')
		.eq('match_id', matchId)
		.order('created_at', { ascending: true });
	if (rErr) { maybeEmitAuthError(rErr); throw rErr; }

	// Fetch any existing results for those registrations
	const regIds = (regs || []).map(r => r.id);
	let resultsByReg = {};
	if (regIds.length > 0) {
		const { data: res, error: mErr } = await supabase
			.from('match_results')
			.select('registration_id, position, kills, prize, status')
			.in('registration_id', regIds);
	if (mErr) { maybeEmitAuthError(mErr); throw mErr; }
		resultsByReg = Object.fromEntries(
			(res || []).map(row => [row.registration_id, row])
		);
	}

	// Map to UI-friendly participant rows (one row per team/registration)
	return (regs || []).map((r, idx) => {
		const rawPlayers = r.players || r.squad || [];
		const first = Array.isArray(rawPlayers) && rawPlayers.length > 0 ? rawPlayers[0] : null;
		const result = resultsByReg[r.id] || {};
		return {
			registrationId: r.id,
			teamName: r.team_name || (r.slot_number ? `Team #${r.slot_number}` : `Team ${idx + 1}`),
			playerId: first?.id || first?.gameId || null,
			playerName: first?.playerName || first?.name || '-',
			playerGameName: first?.gameName || first?.ign || '-',
			playerGameId: first?.gameId || first?.id || '-',
			position: Number(result.position ?? null),
			kills: Number(result.kills ?? 0),
			prizeAmount: Number(result.prize ?? 0),
			prizeCredited: String(result.status || '').toUpperCase() === 'CREDITED',
		};
	});
}

export async function getMatchResults(matchId) {
	const { data, error } = await supabase
		.from('match_results')
		.select('*')
		.eq('match_id', matchId)
		.order('position', { ascending: true });
	if (error) throw error;
	return data;
}

export async function updateMatchResult(matchId, resultData) {
	await ensureSession();
	const row = {
		match_id: matchId,
		registration_id: resultData.registrationId,
		position: resultData.position,
		kills: resultData.kills ?? 0,
		points: resultData.points ?? 0,
		prize: resultData.prize ?? 0,
		status: resultData.status ?? 'PENDING',
	};
	const { data, error } = await supabase
		.from('match_results')
		.upsert(row, { onConflict: 'match_id,registration_id' })
		.select()
		.single();
	if (error) { maybeEmitAuthError(error); throw error; }
	return data;
}

export async function getPrizeDistribution(matchId) {
	await ensureSession();
	const { data, error } = await supabase.rpc('get_prize_distribution', { p_match_id: matchId });
	if (error) { maybeEmitAuthError(error); throw error; }

	// Normalize the RPC output to a stable shape expected by UI
	// Desired shape:
	// {
	//   totalPrizePool: number,
	//   toBeDistributed: number,
	//   undistributedRemainder: number,
	//   winnersCount: number,
	//   distributions: Array<{
	//     registrationId, playerId, playerName, teamName,
	//     kills, position, prizeAmount, alreadyCredited
	//   }>
	// }

	const normalizeItem = (row) => {
		if (!row || typeof row !== 'object') return {
			registrationId: null,
			playerId: null,
			playerName: '',
			teamName: '',
			kills: 0,
			position: 0,
			prizeAmount: 0,
			alreadyCredited: false,
		};
		const status = String(row.status || row.result_status || '').toUpperCase();
		return {
			registrationId: row.registration_id ?? row.registrationId ?? row.id ?? null,
			playerId: row.player_id ?? row.playerId ?? null,
			playerName: row.player_name ?? row.playerName ?? '-',
			teamName: row.team_name ?? row.teamName ?? '-',
			kills: Number(row.kills ?? 0),
			position: Number(row.position ?? 0),
			prizeAmount: Number(row.prize ?? row.prize_amount ?? row.amount ?? 0),
			alreadyCredited: (row.already_credited ?? row.alreadyCredited) === true || status === 'CREDITED',
		};
	};

	// Case 1: RPC returns an object with distributions
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		const rawList = Array.isArray(data.distributions) ? data.distributions : [];
		const distributions = rawList.map(normalizeItem);
		const totalPrizePool = Number(data.totalPrizePool ?? data.total_prize_pool ?? 0);
		const toBeDistributed = Number(
			data.toBeDistributed ??
			data.to_be_distributed ??
			distributions.reduce((s, w) => s + (w.prizeAmount || 0), 0)
		);
		const winnersCount = Number(data.winnersCount ?? distributions.length);
		const undistributedRemainder = Number(
			data.undistributedRemainder ??
			data.remaining ??
			Math.max(0, totalPrizePool - toBeDistributed)
		);
		const normalized = { totalPrizePool, toBeDistributed, undistributedRemainder, winnersCount, distributions };
		// If RPC yielded no effective distribution, compute a client-side fallback
		if ((distributions.length === 0 || toBeDistributed === 0)) {
			const fallback = await computeClientSideDistribution(matchId);
			return fallback || normalized;
		}
		return normalized;
	}

	// Case 2: RPC returns an array of rows; wrap it
	const rows = Array.isArray(data) ? data : [];
	const distributions = rows.map(normalizeItem);
	const toBeDistributed = distributions.reduce((s, w) => s + (w.prizeAmount || 0), 0);
	if (distributions.length === 0 || toBeDistributed === 0) {
		const fallback = await computeClientSideDistribution(matchId);
		if (fallback) return fallback;
	}
	const winnersCount = distributions.filter(w => (w.prizeAmount || 0) > 0).length;
	return {
		totalPrizePool: 0,
		toBeDistributed,
		undistributedRemainder: 0,
		winnersCount,
		distributions,
	};
}

// Fallback distribution calculation using current DB state when RPC returns nothing
async function computeClientSideDistribution(matchId) {
	try {
		// Load match
		const { data: match, error: mErr } = await supabase
			.from('matches')
			.select('id, match_type, entry_fee, prize_pool')
			.eq('id', matchId)
			.single();
		if (mErr) throw mErr;
		const type = String(match?.match_type || '').toUpperCase();
		const entry = Number(match?.entry_fee || 0);
		// Load participants (with current results)
		const participants = await getMatchParticipants(matchId);
		const teams = Array.isArray(participants) ? participants : [];
		const teamCount = teams.length;

		// Compute total pool
		let totalPool = Number(match?.prize_pool ?? 0);
		if (!totalPool || totalPool <= 0) {
			const rate = type === 'SOLO' ? 0.80 : type === 'CLASH_SQUAD' ? 0.85 : 0.90;
			totalPool = Math.round(entry * teamCount * rate);
		}

		const byReg = new Map();
		let toDistribute = 0;
		if (type === 'SOLO') {
			const perKill = Math.round(entry * 0.80);
			teams.forEach(t => {
				const kills = Number(t.kills || 0);
				const prizeAmount = kills > 0 ? kills * perKill : 0;
				if (prizeAmount > 0) {
					byReg.set(t.registrationId, { ...t, prizeAmount });
					toDistribute += prizeAmount;
				}
			});
		} else if (type === 'DUO') {
			const percents = [0.40, 0.30, 0.20, 0.05, 0.05];
			teams.forEach(t => {
				const pos = Number(t.position || 0);
				if (pos >= 1 && pos <= 5) {
					const prizeAmount = Math.round(totalPool * percents[pos - 1]);
					if (prizeAmount > 0) {
						byReg.set(t.registrationId, { ...t, prizeAmount });
						toDistribute += prizeAmount;
					}
				}
			});
		} else if (type === 'CLASH_SQUAD') {
			const winner = teams.find(t => Number(t.position || 0) === 1);
			if (winner && totalPool > 0) {
				const prizeAmount = Math.round(totalPool);
				byReg.set(winner.registrationId, { ...winner, prizeAmount });
				toDistribute += prizeAmount;
			}
		} else { // SQUAD & others
			const percents = [0.40, 0.30, 0.20];
			teams.forEach(t => {
				const pos = Number(t.position || 0);
				if (pos >= 1 && pos <= 3) {
					const prizeAmount = Math.round(totalPool * percents[pos - 1]);
					if (prizeAmount > 0) {
						byReg.set(t.registrationId, { ...t, prizeAmount });
						toDistribute += prizeAmount;
					}
				}
			});
		}

		const distributions = teams.map(t => ({
			registrationId: t.registrationId,
			playerId: t.playerId,
			playerName: t.playerName,
			teamName: t.teamName,
			kills: Number(t.kills || 0),
			position: Number(t.position || 0),
			prizeAmount: Number(byReg.get(t.registrationId)?.prizeAmount || 0),
			alreadyCredited: !!t.prizeCredited,
		}));

		const winnersCount = distributions.filter(d => (d.prizeAmount || 0) > 0).length;
		const undistributedRemainder = Math.max(0, Number(totalPool) - Number(toDistribute));

		return {
			totalPrizePool: Number(totalPool),
			toBeDistributed: Number(toDistribute),
			undistributedRemainder,
			winnersCount,
			distributions,
		};
	} catch (e) {
		// Silent fallback failure; return null to let callers use RPC result
		return null;
	}
}

export async function creditAllPrizes(matchId) {
	await ensureSession();
	const { data, error } = await supabase.rpc('credit_all_prizes', { p_match_id: matchId });
	if (error) { maybeEmitAuthError(error); throw error; }
	return String(data?.message || 'Prizes credited');
}

// Registrations (for viewing participants / slots)
export async function getMatchRegistrations(matchId) {
	const { data, error } = await supabase
		.from('registrations')
		.select('*')
		.eq('match_id', matchId)
		.order('created_at', { ascending: true });
	if (error) throw error;
	return (data || []).map(r => {
		const rawPlayers = r.players || r.squad || [];
		const players = Array.isArray(rawPlayers)
			? rawPlayers.map((p, idx) => ({
				playerName: p.playerName || p.name || '',
				gameName: p.gameName || p.ign || '',
				gameId: p.gameId || p.id || '',
				position: Number(p.position ?? idx + 1),
			}))
			: [];
		return {
			...r,
			players,
			slotNumber: r.slot_number ?? r.slotNumber ?? null,
			playerGameId: r.player_game_id ?? r.playerGameId ?? null,
			playerName: r.player_name ?? r.playerName ?? null,
			createdAt: r.created_at ?? r.createdAt ?? null,
		};
	});
}

// Get user's own registrations
export async function getUserRegistrations() {
	const uid = await getUid();
	const { data, error } = await supabase
		.from('registrations')
		.select('*, matches(*)')
		.eq('user_id', uid)
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data || []).map(r => ({
		...r,
		matchId: r.match_id,
		userId: r.user_id,
	createdAt: r.created_at,
	slotNumber: r.slot_number ?? r.slotNumber ?? null,
	playerGameId: r.player_game_id ?? r.playerGameId ?? null,
	playerName: r.player_name ?? r.playerName ?? null,
		players: Array.isArray(r.players || r.squad)
			? (r.players || r.squad).map((p, idx) => ({
				playerName: p.playerName || p.name || '',
				gameName: p.gameName || p.ign || '',
				gameId: p.gameId || p.id || '',
				position: Number(p.position ?? idx + 1),
			}))
			: [],
		match: r.matches ? {
			id: r.matches.id,
			title: r.matches.title,
			game: r.matches.game,
			matchType: r.matches.match_type,
			entryFee: r.matches.entry_fee,
			scheduledAt: r.matches.scheduled_at,
			mapName: r.matches.map_name,
			gameMode: r.matches.game_mode,
			rules: r.matches.rules,
			rounds: r.matches.rounds,
			status: r.matches.status,
			roomId: r.matches.room_id,
			roomPassword: r.matches.room_password,
			credentialsSentAt: r.matches.credentials_sent_at,
			createdAt: r.matches.created_at,
		} : null,
	}));
}

// Create a registration and deduct entry fee from wallet
export async function registerForMatch(matchId, players = [], paymentMethod = 'wallet') {
	if (!matchId) throw new Error('matchId required');
	const uid = await getUid();

	// 1) Try fast path: server-side RPC to do everything in one transaction
	try {
		const payload = {
			p_match_id: matchId,
			p_players: Array.isArray(players) ? players.map((p, idx) => ({
				playerName: p.playerName,
				gameName: p.gameName,
				gameId: p.gameId,
				role: p.role || (idx === 0 ? 'LEADER' : 'MEMBER'),
				position: idx + 1,
			})) : [],
			p_method: String(paymentMethod || 'wallet').toLowerCase(),
		};
		const { data: rpcData } = await supabase.rpc('register_for_match', payload);
		if (rpcData && typeof rpcData === 'object') {
			// Normalize response shape to existing UI expectation
			const reg = rpcData.registration || rpcData.reg || rpcData;
			const match = rpcData.match || rpcData.matched || null;
			return { ...reg, match };
		}
	} catch (rpcErr) {
		// If RPC is missing or fails, fall back to client-side flow below
		// Only rethrow for explicit insufficient balance or capacity errors surfaced by RPC
		const msg = String(rpcErr?.message || '');
		if (/insufficient/i.test(msg) || /full|capacity/i.test(msg)) throw rpcErr;
	}

	// 2) Fallback: optimize client-side with fewer round trips (parallel fetches)
	// Fetch match and wallet concurrently; also start the count query in parallel
	const [matchRes, walletPrep] = await Promise.all([
		supabase.from('matches').select('*').eq('id', matchId).single(),
		// ensure wallet row exists for user then fetch it
		(async () => {
			await supabase.from('wallets').upsert({ user_id: uid }).select();
			return supabase
				.from('wallets')
				.select('balance, total_spent')
				.eq('user_id', uid)
				.single();
		})(),
	]);

	if (matchRes.error) throw matchRes.error;
	const match = matchRes.data;
	const entryFee = Number(match?.entry_fee ?? match?.entryFee ?? 0);

	const [walletRes, countRes] = await Promise.all([
		walletPrep,
		supabase
			.from('registrations')
			.select('*', { head: true, count: 'exact' })
			.eq('match_id', matchId)
			.eq('status', 'CONFIRMED'),
	]);

	if (countRes?.count != null) {
		const slots = computeSlots(match?.match_type || match?.matchType);
		if (Number(countRes.count || 0) >= slots) {
			const err = new Error('Tournament is full');
			err.code = 'TOURNAMENT_FULL';
			throw err;
		}
	}

	if (walletRes.error) throw walletRes.error;
	const wallet = walletRes.data;
	const balance = Number(wallet?.balance || 0);
	if (paymentMethod === 'wallet' && balance < entryFee) {
		const msg = `Insufficient wallet balance. Need ₹${entryFee}, have ₹${balance}.`;
		const err = new Error(msg);
		err.code = 'INSUFFICIENT_BALANCE';
		throw err;
	}

	// Insert registration
	const leaderName = players?.[0]?.playerName || null;
	const leaderGameId = players?.[0]?.gameId || null;
	const leaderGameName = players?.[0]?.gameName || null;
	const squad = Array.isArray(players)
		? players.map((p, idx) => ({
			playerName: p.playerName,
			gameName: p.gameName,
			gameId: p.gameId,
			position: idx + 1,
			role: p.role || (idx === 0 ? 'LEADER' : 'MEMBER'),
		}))
		: [];
	const { data: reg, error: rErr } = await supabase
		.from('registrations')
		.insert({
			match_id: matchId,
			user_id: uid,
			player_name: leaderName,
			player_game_id: leaderGameId,
			player_game_name: leaderGameName,
			squad,
			status: 'CONFIRMED',
		})
		.select('*')
		.single();
	if (rErr) throw rErr;

	// Spend from wallet and create transaction
	if (paymentMethod === 'wallet' && entryFee > 0) {
		const [{ error: uErr }, { error: tErr }] = await Promise.all([
			supabase
				.from('wallets')
				.update({
					balance: balance - entryFee,
					total_spent: Number(wallet?.total_spent || 0) + entryFee,
					updated_at: new Date().toISOString(),
				})
				.eq('user_id', uid),
			supabase
				.from('wallet_transactions')
				.insert({
					user_id: uid,
					amount: entryFee,
					type: 'SPEND',
					meta: { reason: 'match_registration', match_id: matchId, registration_id: reg.id },
				}),
		]);
		if (uErr) throw uErr;
		if (tErr) throw tErr;
	}

	return { ...reg, match };
}

// Profiles helper (kept for compatibility)
export async function saveProfileToSupabase(client, { id, name, phone }) {
	const sb = client || supabase;
	const { error } = await sb.from('profiles').upsert({ id, name, phone });
	if (error) throw error;
	return true;
}

// ============== UPI (manual) ==============
export async function initiateUpi(amount, payerUpiId, paymentApp) {
	const uid = await getUid();
	// Pre-generate a friendly reference id for Add Money: UPI_<timestamp>_<hex>
	const friendlyRef = `UPI_${Date.now()}_${Math.random().toString(16).slice(2,10)}`;
	const { data, error } = await supabase
		.from('upi_payments')
		.insert({
			user_id: uid,
			amount: Number(amount),
			payer_upi_id: payerUpiId,
			payment_app: paymentApp,
			reference_id: friendlyRef,
			status: 'INITIATED',
		})
		.select()
		.single();
	if (error) throw error;
	return {
		id: data.id,
		amount: data.amount,
		deeplink: null,
		payeeVpa: null,
		payeeName: 'Prime Arena',
		note: `Add money ${friendlyRef}`,
		referenceId: data.reference_id || friendlyRef,
		paymentApp,
	};
}

export async function submitUpiUtr(paymentOrId, utr) {
	// Accept either a numeric id or a payment object. If we only have a local temp id (e.g. "local-...")
	// create a fresh record instead of trying to update by id.
	const rawId = typeof paymentOrId === 'number' ? paymentOrId : paymentOrId?.id;
	const idIsNumeric = typeof rawId === 'number' || (typeof rawId === 'string' && /^\d+$/.test(rawId));

	if (idIsNumeric) {
		const id = typeof rawId === 'number' ? rawId : Number(rawId);
		const { data, error } = await supabase
			.from('upi_payments')
			.update({ utr, status: 'UTR_SUBMITTED' })
			.eq('id', id)
			.select()
			.single();
		if (error) throw error;
		// Fire-and-forget: alert admin that UTR was submitted
		try {
			await supabase.functions.invoke('send-admin-alert', {
				method: 'POST',
				body: { eventType: 'UPI_UTR_SUBMITTED', payment: data },
			});
		} catch (e) { /* non-blocking */ }
		return { message: 'UTR submitted', payment: data };
	}

	// Fallback: insert a new payment row using available context when id is not numeric (e.g. local temp id)
	const uid = await getUid();
	const p = (paymentOrId && typeof paymentOrId === 'object') ? paymentOrId : {};
	const insertPayload = {
		user_id: uid,
		amount: p.amount != null ? Number(p.amount) : null,
		payer_upi_id: p.upiId || p.payerUpiId || null,
		payment_app: p.paymentApp || null,
		// Ensure a standard reference id format for Add Money; prefer provided value, else generate UPI_<timestamp>_<hex>
		reference_id: (p.referenceId && String(p.referenceId).startsWith('UPI_'))
			? p.referenceId
			: `UPI_${Date.now()}_${Math.random().toString(16).slice(2,10)}`,
		utr,
		status: 'UTR_SUBMITTED',
	};
	const { data, error } = await supabase
		.from('upi_payments')
		.insert(insertPayload)
		.select()
		.single();
	if (error) throw error;
	// Fire-and-forget: alert admin that UTR was submitted
	try {
		await supabase.functions.invoke('send-admin-alert', {
			method: 'POST',
			body: { eventType: 'UPI_UTR_SUBMITTED', payment: data },
		});
	} catch (e) { /* non-blocking */ }
	return { message: 'UTR submitted', payment: data };
}

export async function listMyUpiPayments() {
	const uid = await getUid();
	const sinceIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from('upi_payments')
		.select('*')
		.eq('user_id', uid)
		.neq('status', 'INITIATED')
		.or(`created_at.gte.${sinceIso},updated_at.gte.${sinceIso}`)
		.order('created_at', { ascending: false });
	if (error) throw error;
	// Normalize timestamps to stable camelCase fields consumed by UI
	return (data || []).map((r) => ({
		...r,
		// Stable/camel-cased fields for UI
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		referenceId: r.reference_id || r.referenceId,
		amount: Number(r.amount || 0),
		utr: r.utr || null,
		payerUpiId: r.payer_upi_id || r.payerUpiId || null,
		paymentApp: r.payment_app || r.paymentApp || null,
	}));
}

// ============== Withdrawals (admin + user) ==============
export async function listPendingWithdrawals() {
	// Direct: fetch withdrawals first (no embedded join to avoid 400 when FK/policy is missing)
	let rows = [];
	let wq = await supabase
		.from('withdrawals')
	.select('id, user_id, amount, method, details, status, reference_id, created_at')
	.in('status', ['OTP_VERIFIED'])
		.order('created_at', { ascending: true });
	if (wq.error) {
		// Retry without reference_id if column doesn't exist yet
		wq = await supabase
			.from('withdrawals')
			.select('id, user_id, amount, method, details, status, created_at')
			.in('status', ['PENDING', 'OTP_VERIFIED'])
			.order('created_at', { ascending: true });
	}
	if (!wq.error && Array.isArray(wq.data)) {
			rows = wq.data || [];
			const base = rows.map((r) => {
			const d = r.details || {};
			return {
				id: r.id,
				amount: Number(r.amount || 0),
				status: r.status,
				method: (r.method || '').toString().toUpperCase(),
				referenceId: r.reference_id || d.reference_id || `WITH_${r.id}`,
				createdAt: r.created_at,
				// details flattened for UI
				upiId: d.upiId || d.upi_id || d.upi || null,
				accountNumber: d.accountNumber || d.account_number || null,
				ifscCode: d.ifscCode || d.ifsc || d.ifscCode || null,
				accountHolderName: d.accountHolderName || d.account_holder_name || null,
					userEmail: '',
					userPhone: '',
					walletBalance: null,
					balanceBefore: typeof d.balance_before === 'number' ? d.balance_before : null,
					balanceAfter: typeof d.balance_after === 'number' ? d.balance_after : null,
					userId: r.user_id,
			};
			});
			// Enrich with admin financials (email/phone/current balance)
			try {
				const userIds = Array.from(new Set(base.map(b => b.userId).filter(Boolean)));
				if (userIds.length) {
					const { data: fin } = await supabase.rpc('admin_get_user_financials', { p_user_ids: userIds });
					const map = new Map((fin || []).map(x => [x.user_id, x]));
					base.forEach(b => {
						const x = map.get(b.userId);
						if (x) {
							b.userEmail = x.user_email || b.userEmail;
							b.userPhone = x.user_phone || b.userPhone;
							b.walletBalance = typeof x.wallet_balance === 'number' ? x.wallet_balance : b.walletBalance;
						}
					});
				}
			} catch {}
			return base;
	}

	// Fallback: RPC if installed (without profile join). We'll still flatten details.
	const { data, error } = await supabase.rpc('admin_list_pending_withdrawals');
	if (error) {
		// Graceful: if RPC isn't installed, return empty list instead of breaking the UI
		console.warn('admin_list_pending_withdrawals RPC not available:', error?.message || error);
		return [];
	}
	return (data || []).map((r) => {
		const d = r.details || {};
		return {
			id: r.id,
			amount: Number(r.amount || 0),
			status: r.status,
			method: (r.method || '').toString().toUpperCase(),
			referenceId: r.reference_id || d.reference_id || `WITH_${r.id}`,
			createdAt: r.created_at,
			upiId: d.upiId || d.upi_id || d.upi || null,
			accountNumber: d.accountNumber || d.account_number || null,
			ifscCode: d.ifscCode || d.ifsc || d.ifscCode || null,
			accountHolderName: d.accountHolderName || d.account_holder_name || null,
		userEmail: r.user_email || '',
		userPhone: r.user_phone || '',
		walletBalance: typeof r.wallet_balance === 'number' ? r.wallet_balance : null,
		balanceBefore: typeof d.balance_before === 'number' ? d.balance_before : null,
		balanceAfter: typeof d.balance_after === 'number' ? d.balance_after : null,
		};
	});
}

export async function actOnWithdrawal(requestId, action, notes = '', referenceId = null) {
	const normalizedAction = String(action || '').toLowerCase();
	const cleanRef = referenceId && String(referenceId).trim().length ? String(referenceId).trim() : null;
	const { data, error } = await supabase.rpc('act_on_withdrawal', {
		p_request_id: requestId,
		p_action: normalizedAction,
		p_notes: notes || '',
		p_reference_id: cleanRef,
	});
	if (error) throw error;
	// Fire-and-forget: send receipt email via Edge Function (approved or rejected)
	try {
		await supabase.functions.invoke('send-withdrawal-receipt', { body: { requestId } });
	} catch (e) {
		// Non-blocking; log only
		console.warn('send-withdrawal-receipt failed:', e?.message || e);
	}
	return data;
}

// Allow user to cancel their own pending withdrawal (reject + auto-refund per RPC logic)
export async function cancelWithdrawal(requestId, notes = 'user cancelled before OTP verification') {
	try {
		const { data, error } = await supabase.rpc('user_cancel_withdrawal', {
			p_request_id: requestId,
			p_notes: notes,
		});
		if (error) throw error;
		return data;
	} catch (e) {
		// Fallback: reuse admin RPC if available (backend may allow owner rejection)
		return actOnWithdrawal(requestId, 'reject', notes);
	}
}

export async function listMyWithdrawals() {
	const uid = await getUid();
	const sinceIso = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from('withdrawals')
		.select('*')
		.eq('user_id', uid)
		.gte('created_at', sinceIso)
		.order('created_at', { ascending: false });
	if (error) throw error;
	return (data || []).map((r) => {
		const d = r.details || {};
		const ref = r.reference_id || d.reference_id || d.ref || (r.id ? `WITH_${r.id}` : null);
		return {
			...r,
			// Stable timestamps for UI
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			// UI expects camelCase referenceId
			referenceId: ref,
			// Flatten commonly used details
			method: (r.method || '').toString().toUpperCase(),
			upiId: d.upiId || d.upi_id || d.upi || null,
			accountNumber: d.accountNumber || d.account_number || null,
			ifscCode: d.ifscCode || d.ifsc || null,
			accountHolderName: d.accountHolderName || d.account_holder_name || null,
		};
	});
}

// Support: submit a support ticket (email, phone, message)
export async function submitSupportRequest({ email, phone, message }) {
	// Invoke Edge Function to send email from primearena.live (function also records DB row server-side)
	const { data: fnData, error: fnErr } = await supabase.functions.invoke('send-support-email', {
		method: 'POST',
		body: { email, phone, message },
	});
	if (fnErr) throw fnErr;
	return fnData || { ok: true };
}

// Optional: subscriptions for wallet changes for the current user
export function subscribeWallet(callback, userId) {
	const filter = userId ? `user_id=eq.${userId}` : null;
	const name = `realtime-wallet-${userId || 'all'}`;
	return subscribeTable({ channelName: name, table: 'wallets', filter }, callback);
}

// Optional: subscribe to wallet_transactions for a specific user to catch credits/debits
export function subscribeWalletTransactions(callback, userId) {
	const filter = userId ? `user_id=eq.${userId}` : null;
	const name = `realtime-wallet-txns-${userId || 'all'}`;
	return subscribeTable({ channelName: name, table: 'wallet_transactions', filter }, callback);
}

