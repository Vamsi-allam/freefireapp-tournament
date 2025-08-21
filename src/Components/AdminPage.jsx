import React, { useState, useEffect } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { clearUser } from '../redux/userSlice';
import { useNavigate } from 'react-router-dom';
import './AdminPage.css';
import { createMatch, listUpcomingMatches, listMatches, updateMatch, deleteMatch, saveCredentials, sendCredentialsToPlayers, getMatchRegistrations, subscribeMatches, subscribeRegistrations, subscribeResults } from '../utils/api';
import { cancelMatchAndRefund } from '../utils/api';
import { listPendingWithdrawals, actOnWithdrawal } from '../utils/api';
import { getPrizeDistribution } from '../utils/api';
import ResultsManagementModal from './ResultsManagementModal';
import { supabase } from '../supabaseClient';

const tabs = [
  { key: 'scheduler', label: 'Match Scheduler', icon: '⏱️' },
  { key: 'create', label: 'Create Match', icon: '＋' },
  { key: 'manage', label: 'Manage', icon: '⚙️' },
  { key: 'history', label: 'Match History', icon: '🕘' },
  { key: 'upi-payments', label: 'UPI Payments', icon: '💳' },
  { key: 'withdrawals', label: 'Withdrawals', icon: '🏦' }
];

const AdminPage = () => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const { userData } = useSelector((state) => state.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('scheduler');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [allMatches, setAllMatches] = useState([]);
  const [editingMatch, setEditingMatch] = useState(null);
  const [viewingMatch, setViewingMatch] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [roomCredentials, setRoomCredentials] = useState({}); // Track room credentials for each match
  const [savingCredentials, setSavingCredentials] = useState({}); // Track saving state for each match
  const [sendingCredentials, setSendingCredentials] = useState({}); // Track sending state for each match
  const [credentialsSaved, setCredentialsSaved] = useState({}); // Track if credentials were just saved
  const [credentialsSent, setCredentialsSent] = useState({}); // Track if credentials were just sent
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [selectedMatchForResults, setSelectedMatchForResults] = useState(null);
  const [prizeStatsByMatch, setPrizeStatsByMatch] = useState({}); // { [matchId]: { distributed, toBeDistributed, winnersCount } }
  const [showPlayersModal, setShowPlayersModal] = useState(false);
  const [playersForMatch, setPlayersForMatch] = useState([]);
  
  // UPI Payments state
  const [upiPayments, setUpiPayments] = useState([]);
  const [loadingUpiPayments, setLoadingUpiPayments] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(null);
  // Withdrawals state
  const [withdrawals, setWithdrawals] = useState([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [processingWithdrawal, setProcessingWithdrawal] = useState(null);
  // Snackbar
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const openSnack = (message, severity = 'info') => setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack(s => ({ ...s, open: false }));
  // Listen for global snackbar events (e.g., session expired)
  useEffect(() => {
    const onUiSnack = (e) => {
      const { message, severity } = e.detail || {};
      if (message) openSnack(message, severity || 'info');
    };
    window.addEventListener('ui:snackbar', onUiSnack);
    return () => window.removeEventListener('ui:snackbar', onUiSnack);
  }, []);

  // Auto sign-out on unauthorized/expired session
  useEffect(() => {
    const onUnauthorized = (e) => {
      const { isExpired, status } = e.detail || {};
      if (isExpired || status === 401) {
        try { dispatch(clearUser()); } catch {}
        try { navigate('/'); } catch {}
      }
    };
    window.addEventListener('app:unauthorized', onUnauthorized);
    return () => window.removeEventListener('app:unauthorized', onUnauthorized);
  }, [dispatch, navigate]);

  const defaultRules = `General Rules:\n1. Follow game fair-play policies.\n2. No emulator unless specified.\n3. Room ID & Password shared 5 min before start.\n4. Cheating leads to disqualification.`;

  const [form, setForm] = useState({
    title: 'Free Fire Solo Battle',
    game: 'Free Fire',
  matchType: 'SOLO',
    entryFee: 0,
    scheduleDateTime: '',
    mapName: 'Bermuda',
  gameMode: 'SOLO',
  rounds: 7, // for CLASH_SQUAD
  rules: defaultRules
  });

  // Updated map list to match available map images/names requested
  const maps = ['Bermuda','Kalahari','Alpine','Purgatory','NexTerra','Solara'];

  const syncType = (title) => {
    const lower = title.toLowerCase();
  if (lower.includes('clash') || lower.includes('4v4') || lower.includes('4 v 4')) return 'CLASH_SQUAD';
    if (lower.includes('duo')) return 'DUO';
    if (lower.includes('squad')) return 'SQUAD';
    return 'SOLO';
  };

  useEffect(() => {
    refreshLists();
  }, []);

  // Realtime sync via Supabase; remove polling
  useEffect(() => {
    let unsubs = [];
    try {
      // Matches
      unsubs.push(subscribeMatches(() => {
        refreshLists();
        if (activeTab === 'history') loadPrizeStatsForCompleted();
      }));
      // Registrations and Results can affect manage/history views
      unsubs.push(subscribeRegistrations(null, () => {
        refreshLists();
      }));
      unsubs.push(subscribeResults(null, () => {
        if (activeTab === 'history') loadPrizeStatsForCompleted();
        refreshLists();
      }));
    } catch (e) {
      console.warn('Realtime setup (admin) skipped', e);
    }
    return () => {
      unsubs.forEach((u) => { try { u && u(); } catch {} });
    };
  }, [activeTab]);

  // Realtime: auto-refresh UPI payments and withdrawals when their tabs are active
  useEffect(() => {
    let ch = null;
    let debounce = null;
    const schedule = (fn) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(fn, 200);
    };
    try {
      if (activeTab === 'upi-payments') {
        ch = supabase
          .channel('admin-upi-payments')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'upi_payments' }, () => {
            schedule(() => loadUpiPayments());
          })
          .subscribe();
      } else if (activeTab === 'withdrawals') {
        ch = supabase
          .channel('admin-withdrawals')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, () => {
            schedule(() => loadWithdrawals());
          })
          .subscribe();
      }
    } catch (e) {
      console.warn('Admin realtime (payments/withdrawals) not attached', e);
    }
    return () => {
      if (debounce) clearTimeout(debounce);
      if (ch) { try { supabase.removeChannel(ch); } catch {} }
    };
  }, [activeTab]);

  // Load prize stats when history tab is active or matches change
  useEffect(() => {
    if (activeTab === 'history') {
      loadPrizeStatsForCompleted();
    } else if (activeTab === 'upi-payments') {
      loadUpiPayments();
    } else if (activeTab === 'withdrawals') {
      loadWithdrawals();
    }
  }, [activeTab, allMatches]);

  const refreshLists = async () => {
    try {
      const [u, all] = await Promise.all([listUpcomingMatches(), listMatches()]);
      // Show only OPEN, UPCOMING, and LIVE matches in scheduler
  const schedulerList = all
        .filter(match => 
          match.status === 'OPEN' || 
          match.status === 'UPCOMING' || 
          match.status === 'LIVE'
        )
        .sort((a,b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
      setUpcoming(schedulerList);
      setAllMatches(all);
    } catch (e) {
      console.error(e);
    }
  };

  const loadPrizeStatsForCompleted = async () => {
    const completed = allMatches.filter(m => m.status === 'COMPLETED');
    if (completed.length === 0) {
      setPrizeStatsByMatch({});
      return;
    }
    try {
      const entries = await Promise.all(
        completed.map(async (m) => {
          try {
            const dist = await getPrizeDistribution(m.id);
            const distributed = Array.isArray(dist?.distributions)
              ? dist.distributions.reduce((sum, d) => sum + (d.alreadyCredited ? (d.prizeAmount || 0) : 0), 0)
              : 0;
            return [m.id, {
              distributed,
              toBeDistributed: Number(dist?.toBeDistributed || 0),
              winnersCount: Number(dist?.winnersCount || 0)
            }];
          } catch (err) {
            console.warn('Failed loading distribution for match', m.id, err);
            return [m.id, { distributed: 0, toBeDistributed: 0, winnersCount: 0 }];
          }
        })
      );
      setPrizeStatsByMatch(Object.fromEntries(entries));
    } catch (err) {
      console.error('Failed to load prize stats:', err);
    }
  };

  // Withdrawals
  const loadWithdrawals = async () => {
    setLoadingWithdrawals(true);
    try {
      const data = await listPendingWithdrawals();
      setWithdrawals(data);
    } catch (e) {
      console.error('Failed to load withdrawals', e);
      setWithdrawals([]);
    } finally {
      setLoadingWithdrawals(false);
    }
  };

  const handleWithdrawalAction = async (id, action, notes = '') => {
    setProcessingWithdrawal(id);
    try {
      const res = await actOnWithdrawal(id, action, notes);
      openSnack(res.message || 'Done', 'success');
      await loadWithdrawals();
    } catch (e) {
      openSnack(e.message || 'Operation failed', 'error');
    } finally {
      setProcessingWithdrawal(null);
    }
  };

  const computed = (() => {
    const type = form.matchType;
    const slots = type === 'SOLO' ? 48 : type === 'DUO' ? 24 : type === 'CLASH_SQUAD' ? 2 : 12;
    const pool = form.entryFee * slots;
    return {
      slots,
      pool,
      first: type === 'CLASH_SQUAD' ? Math.round(pool) : Math.round(pool * 0.40),
      second: type === 'CLASH_SQUAD' ? 0 : Math.round(pool * 0.30),
      third: type === 'CLASH_SQUAD' ? 0 : Math.round(pool * 0.20)
    };
  })();

  const onChange = (e) => {
    const { name, value } = e.target;
    if (name === 'title') {
      const mt = syncType(value);
      setForm(f => ({ ...f, title: value, matchType: mt, gameMode: mt, rounds: mt==='CLASH_SQUAD' ? (f.rounds||7) : undefined }));
    } else if (name === 'matchType') {
      setForm(f => ({ ...f, matchType: value, gameMode: value, rounds: value==='CLASH_SQUAD' ? (f.rounds||7) : undefined }));
    } else if (name === 'entryFee') {
      setForm(f => ({ ...f, entryFee: Number(value) || 0 }));
    } else if (name === 'rounds') {
      setForm(f => ({ ...f, rounds: Number(value) || 7 }));
    } else {
      setForm(f => ({ ...f, [name]: value }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      const payload = { ...form };
      if (payload.matchType !== 'CLASH_SQUAD') {
        delete payload.rounds;
      }
      await createMatch(payload);
      await refreshLists();
      setActiveTab('scheduler');
    } catch (err) {
      setError(err.message);
    } finally { setCreating(false); }
  };

  const handleEdit = (match) => {
    setEditingMatch({...match});
    setShowEditModal(true);
  };

  const handleViewDetails = (match) => {
    setViewingMatch(match);
    setShowViewModal(true);
  };

  const handleMarkCompleted = async (match) => {
    const proceed = window.confirm(`Mark "${match.title}" as COMPLETED? This will move it to Match History.`);
    if (!proceed) return;
    try {
      const payload = { ...match, status: 'COMPLETED' };
      await updateMatch(match.id, payload);
      await refreshLists();
      openSnack('Match marked as COMPLETED', 'success');
    } catch (e) {
      console.error('Failed to mark completed', e);
      openSnack(e.message || 'Failed to mark match as completed', 'error');
    }
  };

  const openPlayersModal = async (match) => {
    try {
      const regs = await getMatchRegistrations(match.id);
      setPlayersForMatch(regs);
      setViewingMatch(match);
      setShowPlayersModal(true);
    } catch (e) { console.error(e); }
  };

  const handleSaveEdit = async () => {
    try {
      const payload = { ...editingMatch };
      if ((payload.matchType || '').toUpperCase() !== 'CLASH_SQUAD') {
        payload.rounds = null;
      }
      const isCancelling = String(payload.status || '').toUpperCase() === 'CANCELLED';
      if (isCancelling) {
        const proceed = window.confirm(`Cancel "${payload.title}" and refund all registered users?`);
        if (!proceed) return;
      }
      // Save match updates first
      await updateMatch(editingMatch.id, payload);
      // If cancelled, trigger refunds via backend RPC
      if (isCancelling) {
        try {
          const res = await cancelMatchAndRefund(editingMatch.id, 'Cancelled by admin');
          openSnack(`Refunded ${res?.refunded_count ?? 0} users`, 'success');
        } catch (e) {
          console.error('Refund RPC failed:', e);
          openSnack(e.message || 'Failed to refund players. Please run refund manually.', 'error');
        }
      }
      await refreshLists();
      setShowEditModal(false);
      setEditingMatch(null);
    } catch (error) {
      console.error('Error updating match:', error);
      openSnack('Failed to update match: ' + error.message, 'error');
    }
  };

  const handleDeleteMatch = async () => {
    try {
      await deleteMatch(editingMatch.id);
      await refreshLists();
      setShowEditModal(false);
      setEditingMatch(null);
    } catch (error) {
      console.error('Error deleting match:', error);
      openSnack(error.message || 'Failed to delete match', 'error');
    }
  };

  const handleRoomCredentialChange = (matchId, field, value) => {
    setRoomCredentials(prev => ({
      ...prev,
      [matchId]: {
        ...prev[matchId],
        [field]: value
      }
    }));
    
    // Reset saved/sent states when credentials are modified
    setCredentialsSaved(prev => ({ ...prev, [matchId]: false }));
    setCredentialsSent(prev => ({ ...prev, [matchId]: false }));
  };

  const handleSaveCredentials = async (matchId) => {
    const credentials = roomCredentials[matchId];
    const hasRoomId = credentials?.roomId?.trim();
    const hasPassword = credentials?.roomPassword?.trim();
    
    // Allow saving if at least one field has a value
    if (!hasRoomId && !hasPassword) {
      openSnack('Please enter at least Room ID or Password', 'warning');
      return;
    }

    setSavingCredentials(prev => ({ ...prev, [matchId]: true }));
    try {
      // Send the current values, keeping existing ones if not changed
      const currentMatch = allMatches.find(m => m.id === matchId);
      const roomId = hasRoomId ? credentials.roomId : currentMatch?.roomId || '';
      const roomPassword = hasPassword ? credentials.roomPassword : currentMatch?.roomPassword || '';
      
      await saveCredentials(matchId, roomId, roomPassword);
      await refreshLists(); // Refresh to get updated data
      
      // Clear the local state since it's now saved
      setRoomCredentials(prev => ({
        ...prev,
        [matchId]: { roomId: '', roomPassword: '' }
      }));
      
      // Set saved state to show success message
      setCredentialsSaved(prev => ({ ...prev, [matchId]: true }));
      
      // Reset saved state after 2 seconds
      setTimeout(() => {
        setCredentialsSaved(prev => ({ ...prev, [matchId]: false }));
      }, 2000);
      
    } catch (error) {
      console.error('Error saving credentials:', error);
      openSnack('Failed to save credentials', 'error');
    } finally {
      setSavingCredentials(prev => ({ ...prev, [matchId]: false }));
    }
  };

  const handleSendCredentials = async (matchId) => {
    setSendingCredentials(prev => ({ ...prev, [matchId]: true }));
    try {
      await sendCredentialsToPlayers(matchId);
      await refreshLists(); // Refresh to get updated data
      
      // Set sent state to show success message
      setCredentialsSent(prev => ({ ...prev, [matchId]: true }));
      
      // Reset sent state after 3 seconds
      setTimeout(() => {
        setCredentialsSent(prev => ({ ...prev, [matchId]: false }));
      }, 3000);
      
    } catch (error) {
      console.error('Error sending credentials:', error);
      openSnack('Failed to send credentials: ' + error.message, 'error');
    } finally {
      setSendingCredentials(prev => ({ ...prev, [matchId]: false }));
    }
  };

  // UPI Payment Functions
  const enrichUpiPayments = async (rows) => {
    try {
      const userIds = Array.from(new Set(rows.map(r => r.userId).filter(Boolean)));
      if (userIds.length === 0) return rows;

      // Try admin RPC that returns user_email, user_phone, wallet_balance for given users
      try {
        const { data: finData, error: finErr } = await supabase.rpc('admin_get_user_financials', { p_user_ids: userIds });
        if (!finErr && Array.isArray(finData) && finData.length > 0) {
          const finMap = new Map(finData.map(x => [x.user_id || x.id, x]));
          return rows.map(r => {
            const x = finMap.get(r.userId) || {};
            return { ...r,
              userEmail: r.userEmail ?? x.user_email ?? x.email ?? null,
              userPhone: r.userPhone ?? x.user_phone ?? x.phone ?? null,
              walletBalance: (typeof r.walletBalance === 'number') ? r.walletBalance : (typeof x.wallet_balance === 'number' ? x.wallet_balance : null)
            };
          });
        }
      } catch {}

      // Fallback: fetch from profiles and wallets directly (may be restricted by RLS)
      let profMap = new Map();
      let walletMap = new Map();
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, user_email, user_phone')
          .in('id', userIds);
        if (Array.isArray(profs)) profMap = new Map(profs.map(p => [p.id, p]));
      } catch {}
      try {
        const { data: wals } = await supabase
          .from('wallets')
          .select('user_id, balance')
          .in('user_id', userIds);
        if (Array.isArray(wals)) walletMap = new Map(wals.map(w => [w.user_id, w]));
      } catch {}

      return rows.map(r => {
        const p = profMap.get(r.userId);
        const w = walletMap.get(r.userId);
        return { ...r,
          userEmail: r.userEmail ?? p?.user_email ?? null,
          userPhone: r.userPhone ?? p?.user_phone ?? null,
          walletBalance: (typeof r.walletBalance === 'number') ? r.walletBalance : (typeof w?.balance === 'number' ? w.balance : null)
        };
      });
    } catch {
      return rows;
    }
  };

  const loadUpiPayments = async () => {
    setLoadingUpiPayments(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_pending_upi_payments');
      if (error) throw error;
      // Normalize RPC rows to the shape used by the UI (camelCase + safe fallbacks)
      let mapped = (Array.isArray(data) ? data : []).map(r => ({
        id: r.id,
        amount: Number(r.amount || 0),
        status: r.status,
        utr: r.utr || '',
        referenceId: r.reference_id || String(r.id),
        createdAt: r.created_at || r.updated_at || null,
        userId: r.user_id,
        // These optional fields will be populated if the RPC is later extended to join profiles/wallets
        userEmail: r.user_email || r.email || null,
        userPhone: r.user_phone || r.phone || null,
        walletBalance: typeof r.wallet_balance === 'number' ? r.wallet_balance : (typeof r.balance === 'number' ? r.balance : null),
      }));
      mapped = await enrichUpiPayments(mapped);
      setUpiPayments(mapped);
    } catch (error) {
      // Fallback for any RPC error (missing RPC, 400, RLS, etc.): query table directly
      try {
        const { data: rows, error: selErr } = await supabase
          .from('upi_payments')
          .select('*')
          .in('status', ['SUBMITTED', 'UTR_SUBMITTED'])
          .order('created_at', { ascending: false });
        if (selErr) throw selErr;
        let mapped = (rows || []).map(r => ({
          id: r.id,
          amount: Number(r.amount || 0),
          status: r.status,
          utr: r.utr || '',
          referenceId: r.reference_id || String(r.id),
          createdAt: r.created_at || r.updated_at || null,
          userId: r.user_id,
          // We cannot safely join profiles/wallets from the client due to RLS; leave nulls here
          userEmail: null,
          userPhone: null,
          walletBalance: null,
        }));
        mapped = await enrichUpiPayments(mapped);
        setUpiPayments(mapped);
        openSnack('Admin RPC failed. Showing limited fallback. Run the SQL to install/fix RPCs.', 'warning');
      } catch (fallbackErr) {
        console.error('Error loading UPI payments (fallback failed too):', fallbackErr);
        setUpiPayments([]);
      }
    } finally {
      setLoadingUpiPayments(false);
    }
  };

  const handlePaymentAction = async (paymentId, action, notes = '') => {
    setProcessingPayment(paymentId);
    try {
      // Backend RPC expects lowercase actions ('approve' | 'reject')
      const normalized = String(action || '').toLowerCase();
      const { data, error } = await supabase.rpc('admin_act_on_upi_payment', { p_payment_id: paymentId, p_action: normalized, p_notes: notes });
      if (error) throw error;
      openSnack((data && (data.message || data.status)) || `Payment ${normalized}d successfully!`, 'success');
      loadUpiPayments(); // Refresh the list
    } catch (error) {
      const looksLikeMissingRpc = /not\s*found|undefined function|rpc|PGRST/i.test(String(error?.message || ''));
      if (looksLikeMissingRpc) {
        openSnack('Admin RPCs missing. Install RPCs in Supabase to approve/reject and credit wallets.', 'error');
      } else {
        console.error(`Error ${String(action || '').toLowerCase()}ing payment:`, error);
        openSnack(`Failed to ${String(action || '').toLowerCase()} payment. Please try again.`, 'error');
      }
    } finally {
      setProcessingPayment(null);
    }
  };

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch (e) { console.warn('Supabase signOut failed', e); }
    dispatch(clearUser());
    navigate('/');
  };

  const handleManageResults = (match) => {
    setSelectedMatchForResults(match);
    setShowResultsModal(true);
  };

  const handleCloseResultsModal = () => {
    setShowResultsModal(false);
    setSelectedMatchForResults(null);
    refreshLists(); // Refresh data after managing results
    // Also refresh prize stats to reflect new credits
    loadPrizeStatsForCompleted();
  };

  const handlePrizesCredited = async () => {
    await refreshLists();
    await loadPrizeStatsForCompleted();
  };

  // Helpers
  const formatDateTime = (dt) => {
    try {
      const d = new Date(dt);
      return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return dt;
    }
  };

  const formatDateTimeIST = (dt) => {
    if (!dt) return '—';
    const d = new Date(dt);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch {}
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'scheduler':
        return (
          <div className="panel-card">
            <div className="panel-card-header">
              <h2>Match Scheduler & Room Management</h2>
              <p>Manage room credentials and monitor match timings. Credentials are automatically sent 5 minutes before match start if not already sent.</p>
            </div>
            {upcoming.length === 0 ? (
              <div className="empty-state">No upcoming matches scheduled</div>
            ) : (
              <div className="ap-match-cards">
                {upcoming.map(m => {
                  const timeUntil = new Date(m.scheduledAt) - new Date();
                  const hoursUntil = Math.max(0, Math.floor(timeUntil / (1000 * 60 * 60)));
                  const minutesUntil = Math.max(0, Math.floor((timeUntil % (1000 * 60 * 60)) / (1000 * 60)));
                  const timeDisplay = hoursUntil > 0 ? `${hoursUntil}h ${minutesUntil}m` : `${minutesUntil}m`;
                  
                  return (
                    <div key={m.id} className="ap-match-card">
                      <div className="ap-match-header">
                        <div className="ap-match-title-section">
                          <h3 className="ap-match-title">{m.title}</h3>
                          <div className="ap-match-date">{formatDateTime(m.scheduledAt)} • {m.mapName || m.map || 'Map N/A'}</div>
                        </div>
                        <div className="ap-match-status">
                          <span className="ap-status-badge">SCHEDULED</span>
                          <div className="ap-time-until">{timeDisplay}</div>
                        </div>
                      </div>
                      
                      <div className="ap-room-warnings">
                        {((!m.roomId || !m.roomPassword) && !roomCredentials[m.id]?.roomId && !roomCredentials[m.id]?.roomPassword) && (
                          <div className="ap-warning">
                            ⚠️ Room credentials not set. Please add room ID and password, then click Save.
                          </div>
                        )}
                        {(roomCredentials[m.id]?.roomId || roomCredentials[m.id]?.roomPassword) && (
                          <div className="ap-warning-save">
                            ⚠️ You have unsaved changes. Click Save to update room details.
                          </div>
                        )}
                      </div>
                      
                      <div className="ap-room-controls">
                        <div className="ap-room-inputs">
                          <div className="ap-room-field">
                            <label>Room ID</label>
                            <input 
                              type="text" 
                              value={roomCredentials[m.id]?.roomId || m.roomId || ''} 
                              onChange={(e) => handleRoomCredentialChange(m.id, 'roomId', e.target.value)}
                              placeholder="Enter room ID"
                              className="ap-room-input"
                            />
                          </div>
                          <div className="ap-room-field">
                            <label>Room Password</label>
                            <input 
                              type="text" 
                              value={roomCredentials[m.id]?.roomPassword || m.roomPassword || ''} 
                              onChange={(e) => handleRoomCredentialChange(m.id, 'roomPassword', e.target.value)}
                              placeholder="Enter password"
                              className="ap-room-input"
                            />
                          </div>
                        </div>
                        
                        <div className="ap-room-actions">
                          <button 
                            className={`ap-save-btn ${credentialsSaved[m.id] ? 'ap-success' : ''}`}
                            onClick={() => handleSaveCredentials(m.id)}
                            disabled={savingCredentials[m.id] || (!roomCredentials[m.id]?.roomId?.trim() && !roomCredentials[m.id]?.roomPassword?.trim())}
                          >
                            {savingCredentials[m.id] ? '💾 Saving...' : 
                             credentialsSaved[m.id] ? '✅ Saved Successfully!' : 
                             '💾 Save'}
                          </button>
                          <button 
                            className={`ap-send-btn ${credentialsSent[m.id] ? 'ap-success' : ''}`}
                            onClick={() => handleSendCredentials(m.id)}
                            disabled={sendingCredentials[m.id] || (!m.roomId && !roomCredentials[m.id]?.roomId?.trim())}
                          >
                            {sendingCredentials[m.id] ? '✈️ Sending...' : 
                             credentialsSent[m.id] ? '✅ Credentials Sent Successfully!' :
                             (roomCredentials[m.id]?.roomId || roomCredentials[m.id]?.roomPassword) ? '✈️ Send Updated Credentials' :
                             m.credentialsSent ? '✅ Already Sent' : 
                             '✈️ Send Now'}
                          </button>
                        </div>
                      </div>
                      
                      <div className="ap-match-footer">
                        <div className="ap-registration-info">
                          Registered: {m.registeredTeams || 0}/{m.slots} teams
                        </div>
                        <div className="ap-prize-info">
                          Prize Pool: ₹{m.prizePool}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      case 'create':
        return (
          <div className="panel-card">
            <div className="panel-card-header">
              <h2>Create Match</h2>
              <p>Fill details; prize pool auto-calculates based on entry fee & slots.</p>
            </div>
            <form className="ap-form" onSubmit={submit}>
              <div className="ap-grid">
                <label className="ap-field">Title
                  <select name="title" value={form.title} onChange={onChange}>
                    <option>Free Fire Solo Battle</option>
                    <option>Free Fire Duo Battle</option>
                    <option>Free Fire Squad Battle</option>
                    <option>Free Fire Clash Squad 4v4</option>
                  </select>
                </label>
                <label className="ap-field">Game
                  <select name="game" value={form.game} onChange={onChange}>
                    <option>Free Fire</option>
                  </select>
                </label>
                <label className="ap-field">Match Type
                  <input name="matchType" value={form.matchType} readOnly />
                </label>
                <label className="ap-field">Entry Fee (₹)
                  <input name="entryFee" type="number" min="0" value={form.entryFee} onChange={onChange} />
                </label>
                <label className="ap-field">Schedule (Local)
                  <input name="scheduleDateTime" type="datetime-local" value={form.scheduleDateTime} onChange={onChange} required />
                </label>
                <label className="ap-field">Map
                  <select name="mapName" value={form.mapName} onChange={onChange}>
                    {maps.map(mp => <option key={mp}>{mp}</option>)}
                  </select>
                </label>
                <label className="ap-field">Game Mode
                  <input name="gameMode" value={form.gameMode} readOnly />
                </label>
                {form.matchType === 'CLASH_SQUAD' && (
                  <label className="ap-field">Rounds
                    <select name="rounds" value={form.rounds || 7} onChange={onChange}>
                      <option value={7}>7</option>
                      <option value={13}>13</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="ap-prizes">
                <div>Slots: <strong>{computed.slots}</strong></div>
                <div>Total Pool: <strong>₹{computed.pool}</strong></div>
                <div>1st: ₹{computed.first}</div>
                {form.matchType !== 'CLASH_SQUAD' && <div>2nd: ₹{computed.second}</div>}
                {form.matchType !== 'CLASH_SQUAD' && <div>3rd: ₹{computed.third}</div>}
              </div>
              <label className="ap-field full">Rules
                <textarea name="rules" rows={5} value={form.rules} onChange={onChange} />
              </label>
              {error && <div className="ap-error">{error}</div>}
              <div className="ap-actions">
                <button type="submit" disabled={creating} className="ap-submit">{creating ? 'Creating...' : 'Create Match'}</button>
              </div>
            </form>
          </div>
        );
      case 'manage':
  const activeMatches = allMatches
    .filter(match => match.status !== 'COMPLETED' && match.status !== 'CANCELLED')
    .sort((a,b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
        return (
          <div className="panel-card">
            <div className="panel-card-header">
              <h2>Active Tournaments</h2>
              <p>Manage ongoing and upcoming tournaments</p>
            </div>
            {activeMatches.length === 0 ? (
              <div className="empty-state">No active tournaments available</div>
            ) : (
              <div className="ap-tournaments-list">
                {activeMatches.map(match => (
                  <div key={match.id} className="ap-tournament-item">
                    <div className="ap-tournament-header">
                      <div className="ap-tournament-info">
                        <h3 className="ap-tournament-title">{match.title}</h3>
                        <div className="ap-tournament-badges">
                          <span className={`ap-badge ap-badge-${match.matchType.toLowerCase()}`}>
                            {match.matchType}
                          </span>
                          <span className={`ap-badge ap-badge-${match.status.toLowerCase()}`}>
                            {match.status}
                          </span>
                        </div>
                      </div>
                      <div className="ap-tournament-actions">
                        <button 
                          type="button"
                          className="ap-btn ap-btn-secondary"
                          onClick={() => handleEdit(match)}
                        >
                          Edit
                        </button>
                        <button 
                          type="button"
                          className="ap-btn ap-btn-primary"
                          onClick={() => handleViewDetails(match)}
                        >
                          View Details
                        </button>
                        <button 
                          type="button"
                          className="ap-btn ap-btn-secondary"
                          onClick={() => openPlayersModal(match)}
                        >
                          View Players
                        </button>
                        <button
                          type="button"
                          className="ap-btn ap-btn-success"
                          onClick={() => handleMarkCompleted(match)}
                        >
                          Mark Completed
                        </button>
                      </div>
                    </div>
                    <div className="ap-tournament-meta">
                      <div className="ap-meta-item">
                        <span className="ap-meta-icon">📅</span>
                        <span>{new Date(match.scheduledAt).toLocaleDateString()} • {new Date(match.scheduledAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>
                      </div>
                      <div className="ap-meta-item">
                        <span className="ap-meta-icon">🗺️</span>
                        <span>{match.mapName || match.map || 'Map N/A'}</span>
                      </div>
                      <div className="ap-meta-item">
                        <span className="ap-meta-icon">👥</span>
                        <span>
                          {(match.registeredTeams !== null && match.registeredTeams !== undefined) ? match.registeredTeams : 0}/{match.slots} {match.matchType === 'SOLO' ? 'Players' : 'Teams'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'history':
        const completedMatches = allMatches.filter(match => match.status === 'COMPLETED');
        const cancelledMatches = allMatches.filter(match => match.status === 'CANCELLED');
        const historyMatches = [...completedMatches, ...cancelledMatches].sort((a,b) => new Date(b.scheduledAt) - new Date(a.scheduledAt));
        const totalEarnings = completedMatches.reduce((sum, match) => sum + ((match.entryFee || 0) * (match.registeredTeams || 0)), 0);
        const totalParticipants = completedMatches.reduce((sum, match) => sum + (match.registeredTeams || 0), 0);
        const totalDistributed = completedMatches.reduce((sum, match) => sum + (prizeStatsByMatch[match.id]?.distributed || 0), 0);
        const netProfit = totalEarnings - totalDistributed;

        return (
          <div className="ap-history-container">
            {/* Statistics Cards */}
            <div className="ap-stats-grid">
              <div className="ap-stat-card">
                <div className="ap-stat-icon ap-stat-matches">🏆</div>
                <div className="ap-stat-content">
                  <div className="ap-stat-label">Total Matches</div>
                  <div className="ap-stat-value">{completedMatches.length}</div>
                </div>
              </div>
              <div className="ap-stat-card">
                <div className="ap-stat-icon ap-stat-earnings">💰</div>
                <div className="ap-stat-content">
                  <div className="ap-stat-label">Total Earnings</div>
                  <div className="ap-stat-value">₹{totalEarnings}</div>
                </div>
              </div>
              <div className="ap-stat-card">
                <div className="ap-stat-icon ap-stat-distributed">👥</div>
                <div className="ap-stat-content">
                  <div className="ap-stat-label">Distributed</div>
                  <div className="ap-stat-value">₹{totalDistributed}</div>
                </div>
              </div>
              <div className="ap-stat-card">
                <div className="ap-stat-icon ap-stat-profit">📈</div>
                <div className="ap-stat-content">
                  <div className="ap-stat-label">Net Profit</div>
                  <div className="ap-stat-value">₹{netProfit}</div>
                </div>
              </div>
              <div className="ap-stat-card">
                <div className="ap-stat-icon ap-stat-participants">👤</div>
                <div className="ap-stat-content">
                  <div className="ap-stat-label">Participants</div>
                  <div className="ap-stat-value">{totalParticipants}</div>
                </div>
              </div>
            </div>

            {/* Match History Section */}
            <div className="ap-history-section">
              <div className="ap-history-header">
                <h2>Match History & Earnings</h2>
                <p>View completed matches, edit room credentials, and manage results</p>
              </div>

              {historyMatches.length === 0 ? (
                <div className="ap-empty-history">
                  <div className="ap-empty-icon">📊</div>
                  <div className="ap-empty-title">No completed matches yet</div>
                  <div className="ap-empty-subtitle">Completed matches will appear here with earnings details</div>
                </div>
              ) : (
                <div className="ap-history-list">
                  {historyMatches.map(match => (
                    <div key={match.id} className="ap-history-item">
                      <div className="ap-history-main">
                        <div className="ap-history-info">
                          <h3 className="ap-history-title">{match.title}</h3>
                          <div className="ap-history-meta">
                            <span className="ap-history-date">
                              📅 {formatDateTime(match.scheduledAt)}
                            </span>
                            <span className={`ap-history-badge ap-badge-${match.matchType.toLowerCase()}`}>
                              {match.matchType}
                            </span>
                            <span className={`ap-history-badge ap-badge-${(match.status || '').toLowerCase()}`}>
                              {match.status}
                            </span>
                          </div>
                        </div>
                        <div className="ap-history-actions">
                          {match.status === 'COMPLETED' ? (
                            <>
                              <button 
                                className="ap-btn ap-btn-primary ap-manage-results-btn"
                                onClick={() => handleManageResults(match)}
                              >
                                🎯 Manage Results
                              </button>
                              {(() => {
                                const stats = prizeStatsByMatch[match.id] || {};
                                const allCredited = (stats.toBeDistributed || 0) > 0 && (stats.distributed || 0) >= (stats.toBeDistributed || 0);
                                return allCredited ? (
                                  <span className="ap-badge-credited">✓ Prizes Credited</span>
                                ) : null;
                              })()}
                            </>
                          ) : (
                            <button className="ap-btn ap-btn-secondary" disabled title="Match was cancelled">
                              ❌ Cancelled
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="ap-history-details">
                        <div className="ap-earnings-grid">
                          {match.status === 'CANCELLED' ? (
                            <>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Entry Fee</div>
                                <div className="ap-earning-value">₹{match.entryFee} × {match.registeredTeams || 0}</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Refund Status</div>
                                <div className="ap-earning-value ap-earning-neutral">Refunded to all registered players</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Total Earnings</div>
                                <div className="ap-earning-value">₹0</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Distributed</div>
                                <div className="ap-earning-value">₹0</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Net Profit</div>
                                <div className="ap-earning-value">₹0</div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Entry Fee</div>
                                <div className="ap-earning-value">₹{match.entryFee} × {match.registeredTeams || 0}</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Total Earnings</div>
                                <div className="ap-earning-value ap-earning-positive">₹{(match.entryFee || 0) * (match.registeredTeams || 0)}</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Distributable Pool</div>
                                <div className="ap-earning-value ap-earning-neutral">₹{prizeStatsByMatch[match.id]?.toBeDistributed ?? 0}</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Distributed</div>
                                <div className="ap-earning-value ap-earning-neutral">₹{prizeStatsByMatch[match.id]?.distributed ?? 0}</div>
                              </div>
                              <div className="ap-earning-item">
                                <div className="ap-earning-label">Net Profit</div>
                                <div className="ap-earning-value ap-earning-positive">₹{((match.entryFee || 0) * (match.registeredTeams || 0)) - (prizeStatsByMatch[match.id]?.distributed || 0)}</div>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="ap-room-credentials-display">
                          <div className="ap-credential-header">
                            <div className="ap-credential-title">Room Credentials</div>
                            {match.status === 'COMPLETED' ? (
                              <span className="ap-sent-badge">✅ Sent to Participants</span>
                            ) : (
                              <span className="ap-sent-badge muted">🚫 Not Sent (Cancelled)</span>
                            )}
                          </div>
                          <div className="ap-credential-grid">
                            <div className="ap-credential-box">
                              <div className="ap-cred-label">Room ID</div>
                              <div className="ap-cred-value">{match.roomId || '-'}</div>
                              <button className="ap-copy-btn" title="Copy Room ID" onClick={() => copyToClipboard(match.roomId || '')}>📋</button>
                            </div>
                            <div className="ap-credential-box">
                              <div className="ap-cred-label">Password</div>
                              <div className="ap-cred-value">{match.roomPassword || '-'}</div>
                              <button className="ap-copy-btn" title="Copy Password" onClick={() => copyToClipboard(match.roomPassword || '')}>📋</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      
      case 'upi-payments':
        return (
          <div className="ap-upi-payments-container">
            <div className="panel-card">
              <div className="panel-card-header">
                <h2>UPI Payments Management</h2>
                <p>Review and approve/reject UPI payments submitted by users</p>
                <button 
                  className="ap-refresh-btn"
                  onClick={loadUpiPayments}
                  disabled={loadingUpiPayments}
                >
                  {loadingUpiPayments ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              
              {loadingUpiPayments ? (
                <div className="ap-loading">Loading UPI payments...</div>
              ) : upiPayments.length === 0 ? (
                <div className="empty-state">No pending UPI payments to review</div>
              ) : (
                <div className="ap-upi-payments-list">
                  {upiPayments.map(payment => (
                    <div key={payment.id} className="ap-upi-payment-card">
                      <div className="ap-payment-header">
                        <div className="ap-payment-user-info">
                          <h4>User Payment Request</h4>
                          <div className="ap-payment-amount">₹{payment.amount}</div>
                        </div>
                        <div className="ap-payment-status">
                          <span className="ap-status-badge utr-submitted">UTR Submitted</span>
                          <div className="ap-payment-date">{formatDateTimeIST(payment.createdAt)}</div>
                        </div>
                      </div>
                      
                      <div className="ap-payment-details">
                        {payment.referenceId && (
                          <div className="ap-detail-row">
                            <span className="ap-detail-label">Reference ID:</span>
                            <span className="ap-detail-value">{payment.referenceId}</span>
                          </div>
                        )}
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">UTR Number:</span>
                          <span className="ap-detail-value utr-number">{payment.utr || 'Not provided'}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">User Email:</span>
                          <span className="ap-detail-value">{payment.userEmail || '—'}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Phone:</span>
                          <span className="ap-detail-value">{payment.userPhone || '—'}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Wallet Balance:</span>
                          <span className="ap-detail-value">{typeof payment.walletBalance === 'number' ? `₹${payment.walletBalance}` : '—'}</span>
                        </div>
                      </div>
                      
                      <div className="ap-payment-actions">
                        <div className="ap-notes-section">
                          <input
                            type="text"
                            placeholder="Add notes (optional)"
                            className="ap-notes-input"
                            id={`notes-${payment.id}`}
                          />
                        </div>
                        <div className="ap-action-buttons">
                          <button
                            className="ap-approve-btn"
                            onClick={() => {
                              const notes = document.getElementById(`notes-${payment.id}`).value;
                              handlePaymentAction(payment.id, 'APPROVE', notes);
                            }}
                            disabled={processingPayment === payment.id}
                          >
                            {processingPayment === payment.id ? 'Processing...' : '✓ Approve & Credit'}
                          </button>
                          <button
                            className="ap-reject-btn"
                            onClick={() => {
                              const notes = document.getElementById(`notes-${payment.id}`).value;
                              if (window.confirm('Are you sure you want to reject this payment?')) {
                                handlePaymentAction(payment.id, 'REJECT', notes);
                              }
                            }}
                            disabled={processingPayment === payment.id}
                          >
                            {processingPayment === payment.id ? 'Processing...' : '✗ Reject'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case 'withdrawals':
        return (
          <div className="ap-upi-payments-container">
            <div className="panel-card">
              <div className="panel-card-header">
                <h2>Withdrawal Requests</h2>
                <p>Review and mark withdrawals as Paid or Reject</p>
                <button className="ap-refresh-btn" onClick={loadWithdrawals} disabled={loadingWithdrawals}>
                  {loadingWithdrawals ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              {loadingWithdrawals ? (
                <div className="ap-loading">Loading withdrawals...</div>
              ) : withdrawals.length === 0 ? (
                <div className="empty-state">No pending withdrawals</div>
              ) : (
                <div className="ap-upi-payments-list">
                  {withdrawals.map(w => (
                    <div key={w.id} className="ap-upi-payment-card">
                      <div className="ap-payment-header">
                        <div className="ap-payment-user-info">
                          <h4>{w.userEmail || 'User'}{w.userPhone ? ` (${w.userPhone})` : ''}</h4>
                          <div className="ap-payment-amount">₹{w.amount}</div>
                        </div>
                        <div className="ap-payment-status">
                          <span className="ap-status-badge utr-submitted">PENDING</span>
                          <div className="ap-payment-date">{new Date(w.createdAt).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="ap-payment-details">
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Reference:</span>
                          <span className="ap-detail-value">{w.referenceId}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Method:</span>
                          <span className="ap-detail-value">{w.method}</span>
                        </div>
                        {w.method === 'UPI' ? (
                          <div className="ap-detail-row">
                            <span className="ap-detail-label">UPI:</span>
                            <span className="ap-detail-value">{w.upiId}</span>
                          </div>
                        ) : (
                          <>
                            <div className="ap-detail-row">
                              <span className="ap-detail-label">Account:</span>
                              <span className="ap-detail-value">{w.accountNumber}</span>
                            </div>
                            <div className="ap-detail-row">
                              <span className="ap-detail-label">IFSC:</span>
                              <span className="ap-detail-value">{w.ifscCode}</span>
                            </div>
                            <div className="ap-detail-row">
                              <span className="ap-detail-label">Name:</span>
                              <span className="ap-detail-value">{w.accountHolderName}</span>
                            </div>
                          </>
                        )}
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Wallet Before:</span>
                          <span className="ap-detail-value">{typeof w.balanceBefore === 'number' ? `₹${w.balanceBefore}` : '—'}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Wallet After (OTP):</span>
                          <span className="ap-detail-value">{typeof w.balanceAfter === 'number' ? `₹${w.balanceAfter}` : '—'}</span>
                        </div>
                        <div className="ap-detail-row">
                          <span className="ap-detail-label">Current Wallet:</span>
                          <span className="ap-detail-value">{typeof w.walletBalance === 'number' ? `₹${w.walletBalance}` : '—'}</span>
                        </div>
                      </div>
                      <div className="ap-payment-actions">
                        <div className="ap-notes-section">
                          <input type="text" placeholder="Admin notes (optional)" className="ap-notes-input" id={`w-notes-${w.id}`} />
                        </div>
                        <div className="ap-action-buttons">
                          <button className="ap-approve-btn" disabled={processingWithdrawal===w.id}
                            onClick={() => handleWithdrawalAction(w.id, 'APPROVE', document.getElementById(`w-notes-${w.id}`).value)}>
                            {processingWithdrawal===w.id ? 'Processing...' : '✓ Mark Paid'}
                          </button>
                          <button className="ap-reject-btn" disabled={processingWithdrawal===w.id}
                            onClick={() => { const notes = document.getElementById(`w-notes-${w.id}`).value; if (window.confirm('Reject this withdrawal?')) handleWithdrawalAction(w.id, 'REJECT', notes); }}>
                            {processingWithdrawal===w.id ? 'Processing...' : '✗ Reject & Refund'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
        
      default:
        return null;
    }
  };

  return (
    <div className="ap-page">
      <header className="ap-top-bar">
        <div className="ap-brand-area">
          <span className="ap-brand-icon">🏆</span>
          <span className="ap-brand-name">Admin Panel</span>
        </div>
        <div className="ap-user-area">
          <span className="ap-welcome-text">Welcome, {userData?.name}</span>
            <button onClick={handleLogout} className="ap-logout-btn ap-small">Logout</button>
        </div>
      </header>
      <div className="ap-body">
        <div className="ap-tab-bar">
          <nav className="ap-tab-nav" role="tablist" aria-label="Admin navigation">
            {tabs.map(t => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`ap-tab-btn ${activeTab === t.key ? 'ap-active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                <span className="ap-tab-icon" aria-hidden>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <main className="ap-tab-content" role="tabpanel">
          {renderContent()}
        </main>
      </div>

      {/* Edit Match Modal */}
      {showEditModal && editingMatch && (
        <div className="ap-modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="ap-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h2>Edit Match</h2>
              <button 
                className="ap-modal-close"
                onClick={() => setShowEditModal(false)}
              >
                ×
              </button>
            </div>
            <div className="ap-modal-body">
              <p className="ap-modal-subtitle">Update match information and room credentials.</p>
              
              <div className="ap-modal-form">
                <div className="ap-form-row">
                  <div className="ap-form-group">
                    <label>Title</label>
                    <input
                      type="text"
                      value={editingMatch.title}
                      onChange={(e) => setEditingMatch({...editingMatch, title: e.target.value})}
                      className="ap-form-input"
                    />
                  </div>
                  <div className="ap-form-group">
                    <label>Game</label>
                    <input
                      type="text"
                      value={editingMatch.game}
                      onChange={(e) => setEditingMatch({...editingMatch, game: e.target.value})}
                      className="ap-form-input"
                    />
                  </div>
                </div>

                <div className="ap-form-row">
                  <div className="ap-form-group">
                    <label>Type</label>
                    <select
                      value={editingMatch.matchType}
                      onChange={(e) => setEditingMatch({...editingMatch, matchType: e.target.value})}
                      className="ap-form-select"
                    >
                      <option value="SOLO">Solo</option>
                      <option value="DUO">Duo</option>
                      <option value="SQUAD">Squad</option>
                      <option value="CLASH_SQUAD">Clash Squad 4v4</option>
                    </select>
                  </div>
                  {editingMatch.matchType === 'CLASH_SQUAD' && (
                    <div className="ap-form-group">
                      <label>Rounds</label>
                      <select
                        value={editingMatch.rounds || 7}
                        onChange={(e) => setEditingMatch({ ...editingMatch, rounds: parseInt(e.target.value) })}
                        className="ap-form-select"
                      >
                        <option value={7}>7</option>
                        <option value={13}>13</option>
                      </select>
                    </div>
                  )}
                  <div className="ap-form-group">
                    <label>Slots</label>
                    <input
                      type="number"
                      value={editingMatch.slots}
                      onChange={(e) => setEditingMatch({...editingMatch, slots: parseInt(e.target.value)})}
                      className="ap-form-input"
                    />
                  </div>
                </div>

                <div className="ap-form-row">
                  <div className="ap-form-group">
                    <label>Entry Fee (₹)</label>
                    <input
                      type="number"
                      value={editingMatch.entryFee}
                      onChange={(e) => setEditingMatch({...editingMatch, entryFee: parseInt(e.target.value)})}
                      className="ap-form-input"
                    />
                  </div>
                  <div className="ap-form-group">
                    <label>Prize Pool (₹)</label>
                    <input
                      type="number"
                      value={editingMatch.prizePool}
                      onChange={(e) => setEditingMatch({...editingMatch, prizePool: parseInt(e.target.value)})}
                      className="ap-form-input"
                    />
                  </div>
                </div>

                <div className="ap-form-row">
                  <div className="ap-form-group">
                    <label>Date</label>
                    <input
                      type="date"
                      value={editingMatch.scheduledAt ? editingMatch.scheduledAt.split('T')[0] : ''}
                      onChange={(e) => setEditingMatch({...editingMatch, scheduledAt: e.target.value + 'T' + (editingMatch.scheduledAt ? editingMatch.scheduledAt.split('T')[1] : '00:00')})}
                      className="ap-form-input"
                    />
                  </div>
                  <div className="ap-form-group">
                    <label>Time</label>
                    <input
                      type="time"
                      value={editingMatch.scheduledAt ? editingMatch.scheduledAt.split('T')[1]?.substring(0, 5) : ''}
                      onChange={(e) => setEditingMatch({...editingMatch, scheduledAt: (editingMatch.scheduledAt ? editingMatch.scheduledAt.split('T')[0] : '') + 'T' + e.target.value})}
                      className="ap-form-input"
                    />
                  </div>
                </div>

                <div className="ap-form-group">
                  <label>Status</label>
                  <select
                    value={editingMatch.status}
                    onChange={(e) => setEditingMatch({...editingMatch, status: e.target.value})}
                    className="ap-form-select"
                  >
                    <option value="OPEN">Open</option>
                    <option value="UPCOMING">Upcoming</option>
                    <option value="LIVE">Live</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>

                <div className="ap-form-group">
                  <label>Room ID</label>
                  <input
                    type="text"
                    value={editingMatch.roomId || ''}
                    onChange={(e) => setEditingMatch({...editingMatch, roomId: e.target.value})}
                    className="ap-form-input"
                    placeholder="Enter room ID"
                  />
                </div>

                <div className="ap-form-group">
                  <label>Room Password</label>
                  <input
                    type="text"
                    value={editingMatch.roomPassword || ''}
                    onChange={(e) => setEditingMatch({...editingMatch, roomPassword: e.target.value})}
                    className="ap-form-input"
                    placeholder="Enter room password"
                  />
                </div>
              </div>
            </div>
            <div className="ap-modal-footer">
              <button 
                className="ap-btn ap-btn-secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </button>
              <button 
                className="ap-btn ap-btn-danger"
                onClick={handleDeleteMatch}
              >
                Delete
              </button>
              <button 
                className="ap-btn ap-btn-primary"
                onClick={handleSaveEdit}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {showViewModal && viewingMatch && (
        <div className="ap-modal-overlay" onClick={() => setShowViewModal(false)}>
          <div className="ap-modal-content ap-modal-view" onClick={(e) => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h2>Match Details</h2>
              <button 
                className="ap-modal-close"
                onClick={() => setShowViewModal(false)}
              >
                ×
              </button>
            </div>
            <div className="ap-modal-body">
              <p className="ap-modal-subtitle">View room credentials and basic info.</p>
              
              <div className="ap-view-details">
                <div className="ap-detail-row">
                  <div className="ap-detail-group">
                    <label>Title</label>
                    <div className="ap-detail-value">{viewingMatch.title}</div>
                  </div>
                  <div className="ap-detail-group">
                    <label>Type</label>
                    <div className="ap-detail-value">{viewingMatch.matchType}</div>
                  </div>
                </div>

                <div className="ap-detail-row">
                  <div className="ap-detail-group">
                    <label>Date</label>
                    <div className="ap-detail-value">
                      {new Date(viewingMatch.scheduledAt).toLocaleDateString('en-GB')}, {new Date(viewingMatch.scheduledAt).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', hour12: true})}
                    </div>
                  </div>
                  <div className="ap-detail-group">
                    <label>Teams</label>
                    <div className="ap-detail-value">{viewingMatch.registeredTeams || 0}/{viewingMatch.slots}</div>
                  </div>
                </div>
                {String(viewingMatch.matchType).toUpperCase() === 'CLASH_SQUAD' && (
                  <div className="ap-detail-row">
                    <div className="ap-detail-group">
                      <label>Rounds</label>
                      <div className="ap-detail-value">{viewingMatch.rounds || 7}</div>
                    </div>
                    <div className="ap-detail-group">
                      <label>Prize</label>
                      <div className="ap-detail-value">Winner: ₹{Math.round(Number(viewingMatch.prizePool||0))}</div>
                    </div>
                  </div>
                )}

                <div className="ap-detail-row">
                  <div className="ap-detail-group">
                    <label>Room ID</label>
                    <div className="ap-detail-value">{viewingMatch.roomId || '-'}</div>
                  </div>
                  <div className="ap-detail-group">
                    <label>Room Password</label>
                    <div className="ap-detail-value">{viewingMatch.roomPassword || '-'}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="ap-modal-footer">
              <button 
                className="ap-btn ap-btn-primary"
                onClick={() => setShowViewModal(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Management Modal */}
      <ResultsManagementModal
        isOpen={showResultsModal}
        onClose={handleCloseResultsModal}
  matchData={selectedMatchForResults}
  onPrizesCredited={handlePrizesCredited}
      />

      {/* Players Modal */}
      {showPlayersModal && viewingMatch && (
        <div className="ap-modal-overlay" onClick={() => setShowPlayersModal(false)}>
          <div className="ap-modal-content ap-modal-view" onClick={(e) => e.stopPropagation()}>
            <div className="ap-modal-header">
              <h2>Registered Players - Slot Allocation</h2>
              <button className="ap-modal-close" onClick={() => setShowPlayersModal(false)}>×</button>
            </div>
            <div className="ap-modal-body">
              <div className="ap-players-grid">
                {playersForMatch.length === 0 && <div>No registrations yet.</div>}
                {playersForMatch.sort((a,b)=>a.slotNumber-b.slotNumber).map(reg => (
                  <div key={reg.id} className="ap-player-slot">
                    <div className="ap-slot-number">Slot {reg.slotNumber}</div>
                    <div className="ap-slot-user">
                      {reg.players && reg.players.length>0 ? reg.players[0].gameName : reg.matchTitle}
                    </div>
                    {reg.players && (
                      <ul className="ap-slot-roster">
                        {reg.players.sort((p1,p2)=>p1.position-p2.position).map((p, idx) => (
                          <li key={`${reg.id}-${p.position ?? idx}`} className="ap-slot-player-line">
                            <span className="ap-slot-player-game">{p.gameName}</span>
                            {p.playerName && <span className="ap-slot-player-real"> ({p.playerName})</span>}
                            {p.gameId && <span className="ap-slot-player-id"> ID: {p.gameId}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="ap-modal-footer">
              <button className="ap-btn ap-btn-primary" onClick={()=>setShowPlayersModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      <Snackbar
      open={snack.open}
      autoHideDuration={3500}
      onClose={closeSnack}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert onClose={closeSnack} severity={snack.severity} variant="filled" sx={{ width: '100%' }}>
        {snack.message}
      </Alert>
    </Snackbar>
    </div>
  );
};

export default AdminPage;
