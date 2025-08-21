import React, { useEffect, useState, useMemo } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { clearUser, updateProfile, setUser } from '../redux/userSlice';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import RegistrationModal from './RegistrationModal';
import MatchDetailsModal from './MatchDetailsModal';
import WalletModal from './WalletModal';
import ProfileEditModal from './ProfileEditModal';
import './UserPage.css';
import './AdminPage.css'; // reuse admin styles for shell
// Map images
import BermudaImg from '../assets/Bermuda.jpeg';
import KalahariImg from '../assets/kalahari.jpeg';
import AlpineImg from '../assets/Alpine.jpeg';
import PurgatoryImg from '../assets/Purgatory.jpeg';
import NexTerraImg from '../assets/NexTerra.jpeg';
import SolaraImg from '../assets/Solara.jpeg';
import { getUserRegistrations, listMatches, getWalletBalance, getMatchRegistrations, subscribeMatches, subscribeRegistrations, subscribeResults, subscribeWallet, subscribeWalletTransactions } from '../utils/api';
import SupportModal from './SupportModal';

const UserPage = () => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { userData } = useSelector((state) => state.user);
  const [userRegistrations, setUserRegistrations] = useState([]);
  const [loadingRegistrations, setLoadingRegistrations] = useState(true);
  // Default tab should be 'available' when user logs in; restore from storage on refresh
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem('ui.user.activeTab') || 'available';
    } catch { return 'available'; }
  });
  const [walletBalance, setWalletBalance] = useState(0);
  const [matches, setMatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedDetailsMatch, setSelectedDetailsMatch] = useState(null);
  const [showWalletModal, setShowWalletModal] = useState(() => {
    try { return sessionStorage.getItem('ui.user.showWalletModal') === 'true'; }
    catch { return false; }
  });
  const [showMobileTabs, setShowMobileTabs] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [showProfileEditModal, setShowProfileEditModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
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
  // Tick every second for live countdowns on cards
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Persist UI state for refresh resilience
  useEffect(() => {
  try { sessionStorage.setItem('ui.user.activeTab', activeTab); } catch {}
  }, [activeTab]);
  useEffect(() => {
  try { sessionStorage.setItem('ui.user.showWalletModal', String(showWalletModal)); } catch {}
  }, [showWalletModal]);

  const formatCountdown = (ms) => {
    if (!isFinite(ms)) return '—';
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
    const hh = h > 0 ? `${h.toString().padStart(2,'0')}:` : '';
    return `${hh}${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  const fetchWalletBalance = async () => {
    try {
  const data = await getWalletBalance();
  setWalletBalance(Number(data?.balance || 0));
    } catch (error) {
      console.error("Failed to fetch wallet balance:", error);
    }
  };

  const fetchUserProfile = async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .single();
      if (error) throw error;
      if (data) {
        dispatch(updateProfile({
          displayName: data.user_name || data.name || null,
          phoneNumber: data.user_phone || data.phone || null,
          gameId: data.game_id || null,
          avatar: userData?.avatar || sessionStorage.getItem('userAvatar') || auth.user?.user_metadata?.avatar_url || undefined,
        }));
      }
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
    }
  };

  useEffect(() => {
    fetchMatches();
    fetchUserRegistrations();
    fetchWalletBalance();
    fetchUserProfile(); // Fetch latest user profile data
  }, []);
  // Realtime sync via Supabase websockets instead of polling
  useEffect(() => {
    let unsubs = [];
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        // Matches
        unsubs.push(subscribeMatches(() => { fetchMatches(); }));
        // Registrations: limit to current user when available
        unsubs.push(subscribeRegistrations({ userId: uid || null }, () => {
          fetchUserRegistrations();
        }));
        // Results can affect user dashboard stats
        unsubs.push(subscribeResults(null, () => {
          fetchUserRegistrations();
          fetchMatches();
        }));
  // Wallet balance & transactions for current user
  unsubs.push(subscribeWallet(() => { fetchWalletBalance(); }, uid));
  unsubs.push(subscribeWalletTransactions(() => { fetchWalletBalance(); }, uid));
      } catch (e) {
        console.warn('Realtime setup skipped', e);
      }
    })();
    return () => { unsubs.forEach((u) => { try { u && u(); } catch {} }); };
  }, []);

  const fetchMatches = async () => {
    try {
      const rows = await listMatches();
      const now = Date.now();
  const mapped = rows.map(row => {
        const scheduledAt = row.scheduled_at || row.scheduledAt || null;
        const minutesUntilMatch = scheduledAt ? Math.floor((Date.parse(scheduledAt) - now) / 60000) : Number.POSITIVE_INFINITY;
        const match = {
          id: row.id,
          title: row.title,
          game: row.game,
          matchType: row.match_type || row.matchType,
          entryFee: row.entry_fee ?? row.entryFee,
          scheduledAt,
          mapName: row.map_name || row.mapName,
          gameMode: row.game_mode || row.gameMode,
          rules: row.rules,
          rounds: row.rounds,
          status: row.status,
          roomId: row.room_id ?? row.roomId,
          roomPassword: row.room_password ?? row.roomPassword,
      registeredTeams: row.registeredTeams ?? row.registered_teams ?? 0,
      slots: row.slots ?? null,
      prizePool: row.prizePool ?? 0,
        };
    // Show credentials only to registered users during the last 5 minutes before start
    const isRegistered = userRegistrations.some((reg) => reg.matchId === row.id && reg.status === 'CONFIRMED');
    const hasCreds = !!(match.roomId || match.roomPassword);
    const canViewRoomCredentials = isRegistered && hasCreds && minutesUntilMatch <= 5 && minutesUntilMatch >= 0;
    return { match, minutesUntilMatch, canViewRoomCredentials };
      });
      setMatches(mapped);
    } catch (error) {
      console.error("Failed to fetch matches:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserRegistrations = async () => {
    try {
      const data = await getUserRegistrations();
      setUserRegistrations(data);
    } catch (error) {
      console.error("Failed to fetch user registrations:", error);
      // Set empty array as fallback
      setUserRegistrations([]);
    } finally {
      setLoadingRegistrations(false);
    }
  };

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch (e) { console.warn('Supabase signOut failed', e); }
    dispatch(clearUser());
    navigate('/');
  };

  // Debug function to help fix authentication issues
  const checkAuthStatus = () => {
    getWalletBalance()
      .then((data) => console.log("Auth debug - Wallet data:", data))
      .catch((err) => console.log("Auth debug - Wallet error:", err?.message || err));
  };

  const handleEditProfile = () => {
    setShowProfileEditModal(true);
  };

  const handleCloseProfileEdit = () => {
    setShowProfileEditModal(false);
  };

  const handleSaveProfile = async (profileData) => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const payload = {
        id: uid,
        user_name: profileData.name,
        user_phone: profileData.phoneNumber,
        game_id: profileData.gameId,
      };
      const { data, error } = await supabase.from('profiles').upsert(payload).select('*').single();
      if (error) throw error;
      dispatch(updateProfile({
        displayName: data.user_name || data.name || profileData.name,
        phoneNumber: data.user_phone || data.phone || profileData.phoneNumber,
        gameId: data.game_id || profileData.gameId,
      }));
      setShowProfileEditModal(false);
      openSnack('Profile updated successfully!', 'success');
    } catch (error) {
      console.error("Profile update error:", error);
      openSnack('An error occurred while updating profile.', 'error');
    }
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    setShowMobileTabs(false);
  };

  const getTypeColor = (type) => {
    if (!type) return "bg-gray-500";
    const lowerType = type.toLowerCase();
    switch (lowerType) {
      case "solo":
        return "bg-blue-500";
      case "duo":
        return "bg-green-500";
      case "squad":
        return "bg-purple-500";
      case "clash_squad":
        return "bg-pink-600";
      default:
        return "bg-gray-500";
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Date not set";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      console.error("Invalid date string:", dateString);
      return "Invalid date";
    }
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "upcoming":
        return "bg-blue-500";
      case "live":
        return "bg-red-500";
      case "completed":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const getPositionColor = (position) => {
    if (position === 1) return "text-yellow-500";
    if (position === 2) return "text-gray-400";
    if (position === 3) return "text-amber-600";
    return "text-slate-400";
  };

  const handleRegisterClick = (match) => {
    setSelectedMatch(match);
    setShowRegistrationModal(true);
  };

  const handleViewDetailsClick = async (match) => {
    const matchWithCredentials = { ...match, roomId: match.roomId || match.room_id, roomPassword: match.roomPassword || match.room_password };
    setSelectedDetailsMatch(matchWithCredentials);
    try {
  const data = await getMatchRegistrations(match.id);
  setParticipants(data || []);
    } catch (e) { setParticipants([]); }
    setShowDetailsModal(true);
  };

  const handleWalletClick = () => {
    setShowWalletModal(true);
  };

  const handleRegistrationSuccess = (registrationData) => {
    // Refresh user registrations to show the new registration
    fetchUserRegistrations();
    // Refresh matches to update available slots
    fetchMatches();
  // Refresh wallet to reflect immediate deduction
  fetchWalletBalance();
    // You could also show a success message here
  };

  // Filter registrations by status
  const upcomingRegistrations = userRegistrations.filter(
    (reg) => reg.match?.status === "UPCOMING" && reg.status === "CONFIRMED"
  );
  const liveRegistrations = userRegistrations.filter((reg) => reg.match?.status === "LIVE");
  const completedRegistrations = userRegistrations
    .filter((reg) => ["COMPLETED", "CANCELLED"].includes((reg.match?.status || '').toUpperCase()))
    .sort((a,b) => new Date(b.match?.scheduledAt || b.match?.date || 0) - new Date(a.match?.scheduledAt || a.match?.date || 0));

  // Derived statistics for dashboard (only include actually completed matches, not cancelled ones)
  const actuallyCompletedRegistrations = userRegistrations.filter((reg) => reg.match?.status === "COMPLETED");
  const completedResults = actuallyCompletedRegistrations.map(r => r.result).filter(Boolean);
  const totalMatches = userRegistrations.length;
  const wins = completedResults.filter(r => r.position === 1).length;
  const totalKills = completedResults.reduce((s,r)=> s + (r.kills||0), 0);
  const winRate = completedResults.length ? (wins / completedResults.length) * 100 : 0;
  const bestPosition = completedResults.length ? Math.min(...completedResults.map(r => r.position)) : 999;
  const prizeWon = completedResults.reduce((s,r)=> s + (r.prize||0), 0);
  const avgPosition = completedResults.length ? (completedResults.reduce((s,r)=> s + (r.position||0), 0)/completedResults.length) : 0;
  // Total spent should mirror Wallet "Spent" tab: only matches that are COMPLETED
  const totalSpentCompletedOnly = userRegistrations
    .filter(r => r.status === 'CONFIRMED' && (r.match?.status || '').toUpperCase() === 'COMPLETED')
    .reduce((s,r)=> s + (r.match?.entryFee || 0),0);

  // Net profit should consider prize only after admin credits it
  const creditedResults = actuallyCompletedRegistrations
    .map(r => r.result)
    .filter(res => !!res && (res.prizeCredited === true));
  const prizeWonCredited = creditedResults.reduce((s, r) => s + (Number(r.prize || 0)), 0);
  const netProfit = prizeWonCredited - totalSpentCompletedOnly;
  // favorite game type by frequency among registrations
  const typeCounts = userRegistrations.reduce((acc,r)=>{ const t = (r.match?.matchType || r.match?.type || '').toUpperCase(); if(t){ acc[t]=(acc[t]||0)+1;} return acc;},{});
  const favoriteGame = Object.keys(typeCounts).sort((a,b)=> typeCounts[b]-typeCounts[a])[0] || null;
  const recentMatches = [...actuallyCompletedRegistrations]
    .sort((a,b)=> new Date(b.match?.scheduledAt || b.match?.date || 0) - new Date(a.match?.scheduledAt || a.match?.date || 0))
    .slice(0,5);

  // Available matches with time-based rules:
  // - Visible when status is OPEN/UPCOMING
  // - Remain visible for unregistered users until 5 minutes before start, then hide
  const availableMatches = matches.filter((matchWithStatus) => {
    const match = matchWithStatus.match || matchWithStatus; // Handle both new and old structure
    const status = (match.status || '').toString().toUpperCase();
    const isOpenOrUpcoming = status === 'OPEN' || status === 'UPCOMING';
    if (!isOpenOrUpcoming) return false;

    const isRegistered = matchWithStatus.isRegistered !== undefined
      ? matchWithStatus.isRegistered
      : userRegistrations.some((reg) => reg.matchId === match.id && reg.status === 'CONFIRMED');

    const minutes = typeof matchWithStatus.minutesUntilMatch === 'number'
      ? matchWithStatus.minutesUntilMatch
      : Number.POSITIVE_INFINITY;

  // If user is not registered, hide the card starting 5 minutes before start
  if (!isRegistered && minutes <= 5) return false;
    return true;
  });

  // Upcoming matches for user (only registered matches)
  // Helper: determine if a match is "live" (either backend marks LIVE or time has reached/passed)
  const isMatchLive = (mws) => {
    const match = mws.match || mws;
    const statusUpper = (match.status || "").toString().toUpperCase();
    if (statusUpper === 'COMPLETED' || statusUpper === 'CANCELLED') return false;
    if (statusUpper === 'LIVE') return true;
    const minutes = typeof mws.minutesUntilMatch === 'number' ? mws.minutesUntilMatch : Number.POSITIVE_INFINITY;
    // Time-based live window only applies when status isn't explicitly COMPLETED/CANCELLED
    return minutes <= 0 && minutes > -90;
  };

  const upcomingMatches = matches.filter((matchWithStatus) => {
    const match = matchWithStatus.match || matchWithStatus;
    const isRegistered = matchWithStatus.isRegistered !== undefined
      ? matchWithStatus.isRegistered
      : userRegistrations.some((reg) => reg.matchId === match.id && reg.status === "CONFIRMED");

    const statusUpper = (match.status || "").toString().toUpperCase();
    // Never show completed/cancelled in Upcoming
    if (["COMPLETED", "CANCELLED"].includes(statusUpper)) return false;
    const isUpcomingStatus = ["OPEN", "UPCOMING"].includes(statusUpper);

    // Show in Upcoming if registered and (upcoming by status OR currently live)
  // If within last 5 minutes and credentials exist, surface them via canViewRoomCredentials
  const minutes = typeof matchWithStatus.minutesUntilMatch === 'number' ? matchWithStatus.minutesUntilMatch : Number.POSITIVE_INFINITY;
  const hasCreds = !!(match.roomId || match.roomPassword);
  matchWithStatus.canViewRoomCredentials = isRegistered && hasCreds && minutes <= 5 && minutes >= 0;
  return isRegistered && (isUpcomingStatus || isMatchLive(matchWithStatus));
  });

  // Live matches for user (registered and currently live)
  const liveMatches = matches.filter((matchWithStatus) => {
    const match = matchWithStatus.match || matchWithStatus;
    const isRegistered = matchWithStatus.isRegistered !== undefined
      ? matchWithStatus.isRegistered
      : userRegistrations.some((reg) => reg.matchId === match.id && reg.status === "CONFIRMED");
    return isRegistered && isMatchLive(matchWithStatus);
  });

  // Map lookup for map names by match id (helps history cards if registration.match lacks mapName)
  const matchIdToMap = useMemo(() => {
    const out = {};
    matches.forEach(mws => {
      const m = mws.match || mws;
      if (m && m.id) out[m.id] = m.mapName || m.map || '';
    });
    return out;
  }, [matches]);

  // Static mapping of map names to images (lowercased keys)
  const mapImages = useMemo(() => ({
    'bermuda': BermudaImg,
    'bermuda remastered': BermudaImg,
    'kalahari': KalahariImg,
    'purgatory': PurgatoryImg,
    'alpine': AlpineImg,
    'nexterra': NexTerraImg,
    'nex terra': NexTerraImg,
    'solara': SolaraImg
  }), []);
  
  

  return (
    <div className="ap-page user-page">
      {/* Admin-style top bar */}
      <header className="ap-top-bar">
        <div className="ap-brand-area">
          <span className="ap-brand-icon">🏆</span>
          <span className="ap-brand-name">PrimeArena</span>
        </div>
        <div className="ap-user-area">
          <div className="ap-wallet-chip" onClick={handleWalletClick} title="Open wallet">
            <span className="ap-wallet-icon">💰</span>
            <span className="ap-wallet-amount">₹{walletBalance}</span>
          </div>
          <span className="ap-welcome-text">Welcome, {userData?.name || 'Player'}</span>
          <button className="ap-btn ap-small" onClick={handleWalletClick}>My Wallet</button>
          <button onClick={handleLogout} className="ap-logout-btn ap-small">Logout</button>
        </div>
      </header>

      <div className="ap-body">
  {/* Top tab bar removed for user page in favor of bottom nav */}

        {/* Dashboard stats now shown only when Dashboard tab selected */}
        {activeTab === 'dashboard' && (
          <div className="panel-card dashboard-panel">
            <div className="panel-card-header">
              <h2>Your Gaming Dashboard</h2>
              <p>Track your tournaments and gaming progress</p>
            </div>
            
            {/* Player Profile Section */}
            <div className="player-profile-section">
              <div className="profile-card">
                <div className="profile-header">
                  <div className="profile-avatar">
                    {userData?.avatar ? (
                      <img 
                        src={userData.avatar} 
                        alt="Profile" 
                        className="avatar-image" 
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className="avatar-placeholder" style={{ display: userData?.avatar ? 'none' : 'flex' }}>
                      {userData?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                  </div>
                  <div className="profile-info">
                    <h3 className="profile-name">{userData?.name || 'Unknown Player'}</h3>
                    <p className="profile-role">ID: {userData?.gameId || 'Not Updated'}</p>
                  </div>
                  <div className="profile-actions">
                    <button onClick={handleEditProfile} className="edit-profile-btn">
                      ✏️ Edit
                    </button>
                  </div>
                </div>
                <div className="profile-details">
                  <div className="detail-item">
                    <span className="detail-icon">
                      <svg viewBox="0 0 48 48" className="gmail-icon">
                        <path fill="#4285F4" d="M24,9.5c3.54,0,6.71,1.22,9.21,3.6l6.85-6.85C35.9,2.38,30.47,0,24,0 C14.62,0,6.51,5.38,2.56,13.22l7.98,6.19C12.43,13.72,17.74,9.5,24,9.5z"/>
                        <path fill="#34A853" d="M46.98,24.55c0-1.57-0.15-3.09-0.38-4.55H24v9.02h12.94c-0.58,2.96-2.26,5.48-4.78,7.18l7.73,6 c4.51-4.18,7.09-10.36,7.09-17.65C46.98,24.55,46.98,24.55,46.98,24.55z"/>
                        <path fill="#FBBC05" d="M10.53,28.59c-0.48-1.45-0.76-2.99-0.76-4.59s0.27-3.14,0.76-4.59l-7.98-6.19C0.92,16.46,0,20.12,0,24 c0,3.88,0.92,7.54,2.56,10.78L10.53,28.59z"/>
                        <path fill="#EA4335" d="M24,48c6.48,0,11.93-2.13,15.89-5.81l-7.73-6c-2.15,1.45-4.92,2.3-8.16,2.3 c-6.26,0-11.57-4.22-13.47-9.91l-7.98,6.19C6.51,42.62,14.62,48,24,48z"/>
                        <path fill="none" d="M0,0h48v48H0V0z"/>
                      </svg>
                    </span>
                    <div className="detail-content">
                      <span className="detail-label">
                        🔒 Email                        
                      </span>
                      <span className="detail-value">
                        {userData?.email || 'Not provided'}
                      </span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <span className="detail-icon">📱</span>
                    <div className="detail-content">
                      <span className="detail-label">Phone</span>
                      <span className="detail-value">{userData?.phone || userData?.phonenumber || 'Not provided'}</span>
                    </div>
                  </div>
                  <div className="detail-item">
                    <span className="detail-icon">💰</span>
                    <div className="detail-content">
                      <span className="detail-label">Wallet Balance</span>
                      <span className="detail-value wallet-balance">₹{walletBalance}</span>
                    </div>
                    <button onClick={handleWalletClick} className="profile-add-money-btn">
                      + Add Money
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="dash-stats-grid">
              <div className="dash-stat-card">
                <div className="dash-icon trophy">🏆</div>
                <div className="dash-value white">{totalMatches}</div>
                <div className="dash-label">Total Matches</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-icon win">🥇</div>
                <div className="dash-value green">{wins}</div>
                <div className="dash-label">Wins</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-icon kills">🎯</div>
                <div className="dash-value red">{totalKills}</div>
                <div className="dash-label">Total Kills</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-icon rate">📈</div>
                <div className="dash-value purple">{winRate.toFixed(0)}%</div>
                <div className="dash-label">Win Rate</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-icon best">⚡</div>
                <div className="dash-value blue">#{bestPosition}</div>
                <div className="dash-label">Best Position</div>
              </div>
              <div className="dash-stat-card">
                <div className="dash-icon prize">🏆</div>
                <div className="dash-value gold">₹{prizeWon}</div>
                <div className="dash-label">Prize Won</div>
              </div>
            </div>
            <div className="dash-lower-grid">
              <div className="dash-panel performance">
                <h3>Performance Overview</h3>
                <p>Your gaming statistics</p>
                <div className="perf-rows">
                  <div className="perf-row"><span>Average Position:</span><span className="metric">#{avgPosition.toFixed(1)}</span></div>
                  <div className="perf-row"><span>Favorite Game:</span><span className="metric pill">{favoriteGame || '—'}</span></div>
                  <div className="perf-row"><span>Total Spent:</span><span className="metric spent">₹{totalSpentCompletedOnly}</span></div>
                  <div className="perf-row"><span>Net Profit:</span><span className={`metric ${netProfit>=0? 'profit':'loss'}`}>₹{netProfit}</span></div>
                </div>
              </div>
              <div className="dash-panel recent">
                <h3>Recent Performance</h3>
                <p>Your last few matches</p>
                {recentMatches.length === 0 ? (
                  <div className="recent-empty">No recent matches</div>
                ) : (
                  <ul className="recent-list">
                    {recentMatches.map(r => (
                      <li key={r.id || r.matchId} className="recent-item">
                        <span className="r-title">{r.match?.title || 'Match'}</span>
                        <span className="r-pos">#{r.result?.position || r.position}</span>
                        <span className="r-kills">{r.result?.kills || r.kills}K</span>
                        <span className="r-prize">₹{r.result?.prize || r.prize}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <main className="ap-tab-content">
          {/* Upcoming Matches */}
          {activeTab === 'upcoming' && (
            <div className="tab-panel">
              <h3 className="section-title">Your Upcoming Tournaments</h3>
              {loadingRegistrations ? (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Loading your registrations...</p>
                </div>
              ) : upcomingMatches.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">⏰</div>
                  <h3>No Upcoming Matches</h3>
                  <p>You haven't registered for any upcoming tournaments</p>
                  <button 
                    className="cta-btn"
                    onClick={() => setActiveTab('available')}
                  >
                    Browse Tournaments
                  </button>
                </div>
              ) : (
                <div className="cards-grid">
                  {upcomingMatches
                    .slice()
                    .sort((a,b)=> new Date((a.match||a).scheduledAt || (a.match||a).date || 0) - new Date((b.match||b).scheduledAt || (b.match||b).date || 0))
                    .map((matchWithStatus) => {
                    const match = matchWithStatus.match || matchWithStatus;
                    const registration = userRegistrations.find(reg => reg.matchId === match.id);
                    const mapKey = (match.mapName || match.map || '').toLowerCase().trim();
                    const bgImg = mapImages[mapKey];
                    return (
                      <div key={match.id} className="tournament-card upcoming-card" style={bgImg ? { '--upc-bg': `url(${bgImg})` } : {}}>
                      <div className="card-header">
                        <div className="card-badges">
                          <span className={`type-badge ${getTypeColor(match.matchType || match.type)}`}>
                            {(match.matchType || match.type || 'UNKNOWN').toUpperCase().replace('CLASH_SQUAD','CLASH SQUAD')}
                          </span>
                          {isMatchLive(matchWithStatus) ? (
                            <span className="status-badge live">LIVE</span>
                          ) : (
                            <span className="status-badge registered">
                            <span className="check-icon">✓</span>
                            REGISTERED
                          </span>
                          )}
                          {/* Show user's allocated slot number when registered */}
                          {!isMatchLive(matchWithStatus) && registration?.slotNumber ? (
                            <span className="status-badge slot">SLOT #{registration.slotNumber}</span>
                          ) : null}
                          {/* room-ready moved to next line below badges */}
                        </div>
                        {matchWithStatus.canViewRoomCredentials && (
                          <div className="room-ready-line">
                            <span className="status-badge room-ready">🎮 ROOM READY</span>
                          </div>
                        )}
                        <h4 className="card-title">{match.title}</h4>
                        <div className="card-date">
                          <span className="calendar-icon">📅</span>
                          <span>{formatDate(match.scheduledAt || match.date)}</span>
                        </div>
                      </div>
                      <div className="card-content">
                        <div className="card-details">
                          <div className="detail-row">
                            <span>Map:</span>
                            <span className="detail-value">{match.mapName || match.map || '—'}</span>
                          </div>
                        </div>
                        {(matchWithStatus.canViewRoomCredentials || (isMatchLive(matchWithStatus) && match.roomId)) && (
                          <div className="room-details">
                            <div className="room-header">🎮 Room Details Available:</div>
                            <div className="room-info">
                              <div>Room ID: {match.roomId}</div>
                              <div>Password: {match.roomPassword}</div>
                            </div>
                            <div className="room-timer">
                              {isMatchLive(matchWithStatus)
                                ? '🔴 Live now'
                                : `⏰ Match starts in ${matchWithStatus.minutesUntilMatch} minutes`}
                            </div>
                          </div>
                        )}
                        <button 
                          type="button"
                          className="view-details-btn"
                          onClick={() => handleViewDetailsClick(match)}
                        >
                          View Details
                        </button>
                      </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Live Matches */}
          {activeTab === 'live' && (
            <div className="tab-panel">
              <h3 className="section-title">Live Tournaments</h3>
              {liveMatches.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">▶️</div>
                  <h3>No Live Matches</h3>
                  <p>You don't have any tournaments running right now</p>
                </div>
              ) : (
                <div className="cards-grid">
                  {liveMatches
                    .slice()
                    .sort((a,b)=> new Date((a.match||a).scheduledAt || (a.match||a).date || 0) - new Date((b.match||b).scheduledAt || (b.match||b).date || 0))
                    .map((matchWithStatus) => {
                    const match = matchWithStatus.match || matchWithStatus;
                    const registration = userRegistrations.find(reg => reg.matchId === match.id);
                    return (
                      <div key={match.id} className="tournament-card live-card">
                        <div className="card-header">
                          <div className="card-badges">
                            <span className={`type-badge ${getTypeColor(match.matchType || match.type)}`}>
                              {(match.matchType || match.type || 'UNKNOWN').toUpperCase().replace('CLASH_SQUAD','CLASH SQUAD')}
                            </span>
                            <span className="status-badge live">LIVE</span>
                            {/* room-ready moved to next line below badges */}
                          </div>
                          {matchWithStatus.canViewRoomCredentials && (
                            <div className="room-ready-line">
                              <span className="status-badge room-ready">🎮 ROOM READY</span>
                            </div>
                          )}
                          <h4 className="card-title">{match.title}</h4>
                          <div className="card-date">
                            <span className="calendar-icon">📅</span>
                            <span>{formatDate(match.scheduledAt || match.date)}</span>
                          </div>
                        </div>
                        <div className="card-content">
                          <div className="card-details">
                            <div className="detail-row">
                              <span>Map:</span>
                              <span className="detail-value">{match.mapName || match.map || '—'}</span>
                            </div>
                            <div className="detail-row">
                              <span>Entry Fee:</span>
                              <span className="fee-value">₹{match.entryFee}</span>
                            </div>
                            <div className="detail-row">
                              <span>Prize Pool:</span>
                              <span className="prize-value">₹{match.prizePool}</span>
                            </div>
                          </div>
                          {match.roomId && (
                            <div className="room-details live-room">
                              <div className="room-header">🔴 Room Details:</div>
                              <div className="room-info">
                                <div>Room ID: {match.roomId}</div>
                                <div>Password: {match.roomPassword}</div>
                              </div>
                            </div>
                          )}
                          <button 
                            type="button"
                            className="view-details-btn"
                            onClick={() => handleViewDetailsClick(match)}
                          >
                            View Details
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Match History */}
          {activeTab === 'completed' && (
            <div className="tab-panel">
              <h3 className="section-title">Match History & Results</h3>
              {completedRegistrations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🏆</div>
                  <h3>No Match History</h3>
                  <p>You haven't participated in any completed or cancelled tournaments yet</p>
                </div>
              ) : (
                <div className="cards-grid">
                  {completedRegistrations.map((registration) => (
                    <div key={registration.id} className="tournament-card">
                      <div className="card-header">
                        <div className="card-badges">
                          <span className={`type-badge ${getTypeColor(registration.match.matchType || registration.match.type)}`}>
                            {(registration.match.matchType || registration.match.type || 'UNKNOWN').toUpperCase().replace('CLASH_SQUAD','CLASH SQUAD')}
                          </span>
                          <span className={`status-badge ${registration.match.status === 'CANCELLED' ? 'cancelled' : 'completed'}`}>
                            {registration.match.status === 'CANCELLED' ? 'CANCELLED' : 'COMPLETED'}
                          </span>
                        </div>
                        <h4 className="card-title">{registration.match.title}</h4>
                        <div className="card-date">
                          <span className="calendar-icon">📅</span>
                          <span>{formatDate(registration.match.scheduledAt || registration.match.date)}</span>
                        </div>
                      </div>
                      <div className="card-content">
                        <div className="card-details">
                          <div className="detail-row">
                            <span>Map:</span>
                            <span className="detail-value">{registration.match?.mapName || registration.match?.map || matchIdToMap[registration.match?.id] || '—'}</span>
                          </div>
                          {/* Players list: show solo details or team roster */}
                          {registration.match?.matchType === 'SOLO' ? (
                            <div className="detail-row">
                              <span>Player:</span>
                              <span className="detail-value">
                                {registration.players?.[0]?.playerName || '—'}
                                {registration.players?.[0]?.gameId ? ` (ID: ${registration.players[0].gameId})` : ''}
                              </span>
                            </div>
                          ) : (
                            <div className="detail-row" style={{display:'block'}}>
                              <span>Team Players:</span>
                              <ul style={{marginTop: '0.5rem', paddingLeft: '1rem'}}>
                                {registration.players?.map((p, idx) => (
                                  <li key={idx}>
                                    {p.playerName} {p.gameId ? `(ID: ${p.gameId})` : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {registration.match.status === 'CANCELLED' ? (
                            <div className="cancellation-notice">
                              <div className="detail-row">
                                <span>Status:</span>
                                <span className="cancelled-text">⚠️ Match cancelled due to insufficient registrations</span>
                              </div>
                              <div className="detail-row">
                                <span>Entry Fee:</span>
                                <span className="refund-text">✅ ₹{registration.match.entryFee || 0} (Refunded)</span>
                              </div>
                            </div>
                          ) : registration.result && (
                            <>
                              {registration.match?.matchType !== 'SOLO' && (
                                <div className="detail-row">
                                  <span>Position:</span>
                                  <span className={`position-value ${getPositionColor(registration.result.position)}`}>
                                    #{registration.result.position}
                                  </span>
                                </div>
                              )}
                              <div className="detail-row">
                                <span>{registration.match?.matchType === 'SOLO' ? 'Kills:' : 'Team Kills:'}</span>
                                <span className="detail-value">{registration.result.kills}</span>
                              </div>
                              <div className="detail-row">
                                <span>Prize Won:</span>
                                <span className="prize-value">₹{registration.result.prize}</span>
                              </div>

                              {/* Completion status message */}
                              <div className="completion-notice">
                                <div className="detail-row">
                                  <span>Status:</span>
                                  <span className="completed-text">🏁 Match completed</span>
                                </div>
                                {Number(registration.result.prize || 0) > 0 ? (
                                  <div className="detail-row">
                                    <span>Prize Status:</span>
                                    {registration.result.prizeCredited === true ? (
                                      <span className="credit-text">✅ ₹{registration.result.prize} credited to wallet</span>
                                    ) : (
                                      <span className="credit-pending-text">⏳ ₹{registration.result.prize} pending credit (awaiting verification)</span>
                                    )}
                                  </div>
                                ) : (
                                  <div className="detail-row">
                                    <span>Result:</span>
                                    <span className="no-prize-text">Better luck next time</span>
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Available Tournaments */}
          {activeTab === 'available' && (
            <div className="tab-panel">
              <h3 className="section-title">Available Tournaments</h3>
              {isLoading ? (
                <div className="loading-state">
                  <div className="spinner"></div>
                  <p>Loading tournaments...</p>
                </div>
              ) : availableMatches.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">🏆</div>
                  <h3>No Available Tournaments</h3>
                  <p>tournaments are currently unavailable</p>
                </div>
              ) : (
                <div className="cards-grid">
                  {availableMatches
                    .slice()
                    .sort((a,b)=> new Date((a.match||a).scheduledAt || (a.match||a).date || 0) - new Date((b.match||b).scheduledAt || (b.match||b).date || 0))
                    .map((matchWithStatus) => {
                    const match = matchWithStatus.match || matchWithStatus;
                    // Use isRegistered from backend response, or fallback to checking userRegistrations
                    const isRegistered = matchWithStatus.isRegistered !== undefined ? 
                      matchWithStatus.isRegistered : 
                      userRegistrations.some((reg) => reg.matchId === match.id && reg.status === "CONFIRMED");
                    
                    return (
                      <div key={match.id} className="tournament-card available-card">
                        {(() => {
                          const mapKey = (match.mapName || match.map || '').toLowerCase().trim();
                          const img = mapImages[mapKey];
                          if (!img) return null; // no image for this map
                          return (
                            <div className="map-image-wrapper">
                              <img src={img} alt={match.mapName || match.map || 'Map'} loading="lazy" />
                              <div className="map-label">{match.mapName || match.map}</div>
                            </div>
                          );
                        })()}
                        <div className="card-header">
                          <div className="card-badges">
                            <span className={`type-badge ${getTypeColor(match.matchType || match.type)}`}>
                              {(match.matchType || match.type || 'UNKNOWN').toUpperCase()
                            }</span>
                            {(() => {
                              if (isRegistered) {
                                return (
                                  <span className="status-badge registered">
                                    <span className="check-icon">✓</span>
                                    REGISTERED
                                  </span>
                                );
                              }
                              const isFull = Number(match.registeredTeams || 0) >= Number(match.slots || 0);
                              if (isFull) {
                                return (
                                  <span className="status-badge full">FULL</span>
                                );
                              }
                              // Determine if registration window has closed
                              const minutes = typeof matchWithStatus.minutesUntilMatch === 'number'
                                ? matchWithStatus.minutesUntilMatch
                                : Number.POSITIVE_INFINITY;
                              const parsed = Date.parse(match.scheduledAt || match.date || '');
                              const scheduledMs = isNaN(parsed)
                                ? nowTs + (isFinite(minutes) ? minutes * 60 * 1000 : 0)
                                : parsed;
                              // Registration closes 5 minutes before start (aligned with backend)
                              const registrationCloseMs = scheduledMs - 7 * 60 * 1000;
                              const isClosed = nowTs >= registrationCloseMs;
                              return (
                                <span className={`status-badge ${isClosed ? 'closed' : 'open'}`}>
                                  {isClosed ? 'CLOSED' : 'OPEN'}
                                </span>
                              );
                            })()}
                            {/* If registered, also show allocated slot number */}
                            {isRegistered && (() => {
                              const reg = userRegistrations.find((r) => r.matchId === match.id && r.status === 'CONFIRMED');
                              return reg?.slotNumber ? (
                                <span className="status-badge slot">SLOT #{reg.slotNumber}</span>
                              ) : null;
                            })()}
                          </div>
                          <h4 className="card-title">{match.title}</h4>
                          <div className="card-date">
                            <span className="calendar-icon">📅</span>
                            <span>{formatDate(match.scheduledAt || match.date)}</span>
                          </div>
                        </div>
                        <div className="card-content">
                          <div className="card-details">
                            <div className="detail-row">
                              <span>Map:</span>
                              <span className="detail-value">{match.mapName || match.map || '—'}</span>
                            </div>
                            <div className="detail-row">
                              <span>Entry Fee:</span>
                              <span className="fee-value">₹{match.entryFee}</span>
                            </div>
                            <div className="detail-row">
                              <span>Prize Pool:</span>
                              <span className="prize-value">₹{match.prizePool}</span>
                            </div>
                            <div className="detail-row">
                              <span>{(() => {
                                const t = String(match.matchType || match.type || '').toUpperCase();
                                if (t === 'SOLO') return 'Players:';
                                if (t === 'DUO') return 'Duos:';
                                return 'Squads:';
                              })()}</span>
                              <div className="teams-info">
                                <span className="users-icon">👥</span>
                                <span>{match.registeredTeams}/{match.slots}</span>
                              </div>
                            </div>
                          </div>
                          <div className="progress-bar">
                            <div 
                              className="progress-fill"
                              style={{ width: `${(match.registeredTeams / match.slots) * 100}%` }}
                            ></div>
                          </div>
                          {(() => {
                            // Compute countdown times
                            const minutes = typeof matchWithStatus.minutesUntilMatch === 'number'
                              ? matchWithStatus.minutesUntilMatch
                              : Number.POSITIVE_INFINITY;
                            // Prefer scheduledAt/date when present
                            const parsed = Date.parse(match.scheduledAt || match.date || '');
                            const scheduledMs = isNaN(parsed)
                              ? nowTs + (isFinite(minutes) ? minutes * 60 * 1000 : 0)
                              : parsed;
                            const registrationCloseMs = scheduledMs - 7 * 60 * 1000; // closes 7 minutes before
                            const timeLeftMs = isRegistered
                              ? Math.max(0, scheduledMs - nowTs)
                              : Math.max(0, registrationCloseMs - nowTs);
                            const label = isRegistered ? 'Starts in' : 'Registration closes in';
                            const warn = !isRegistered && timeLeftMs <= 5 * 60 * 1000; // last 5 minutes
                            return (
                              <div className={`registration-timer ${warn ? 'warn' : ''}`} style={{marginTop:'0.5rem'}}>
                                <span style={{opacity:0.85}}>{label}: </span>
                                <strong>{formatCountdown(timeLeftMs)}</strong>
                              </div>
                            );
                          })()}
                          <div className="card-actions">
                            <button 
                              type="button"
                              className="view-details-btn"
                              onClick={() => handleViewDetailsClick(match)}
                            >
                              <span className="eye-icon">👁️</span>
                              View Details
                            </button>
                            {(() => {
                              const minutes = typeof matchWithStatus.minutesUntilMatch === 'number'
                                ? matchWithStatus.minutesUntilMatch
                                : Number.POSITIVE_INFINITY;
                              // Compute live scheduled time and 5-minute cutoff using nowTs
                              const parsed = Date.parse(match.scheduledAt || match.date || '');
                              const scheduledMs = isNaN(parsed)
                                ? nowTs + (isFinite(minutes) ? minutes * 60 * 1000 : 0)
                                : parsed;
                              const registrationCloseMs = scheduledMs - 7 * 60 * 1000;
                              const isClosed = nowTs >= registrationCloseMs;
                              const normalizedStatus = String(match.status || matchWithStatus.status || '').toUpperCase();
                              if (isRegistered) {
                                return (
                                  <button type="button" className="register-btn registered" disabled>
                                    Already Registered
                                  </button>
                                );
                              }
                              const isFull = Number(match.registeredTeams || 0) >= Number(match.slots || 0);
                              if (isFull) {
                                return (
                                  <button type="button" className="register-btn" disabled title="All slots are filled">
                                    Tournament Full
                                  </button>
                                );
                              }
                              // If backend marks the match as CLOSED/CANCELLED, or local cutoff reached, disable
                              if ((normalizedStatus && normalizedStatus !== 'OPEN') || isClosed) {
                                const label = normalizedStatus === 'CANCELLED' ? 'Cancelled' : 'Registration Closed';
                                return (
                                  <button type="button" className="register-btn" disabled title="Registration is not available for this match">
                                    {label}
                                  </button>
                                );
                              }
                              return (
                                <button type="button" className="register-btn" onClick={() => handleRegisterClick(match)}>
                                  Register Now
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* User Statistics */}
          {/* Dashboard tab content is rendered above inside panel-card; no separate block here */}
        </main>
      </div>

      {/* Registration Modal */}
      <RegistrationModal
        isOpen={showRegistrationModal}
        onClose={() => setShowRegistrationModal(false)}
        match={selectedMatch}
        onRegistrationSuccess={handleRegistrationSuccess}
      />

      {/* Match Details Modal */}
      <MatchDetailsModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        match={selectedDetailsMatch}
        userRegistrations={userRegistrations}
        participants={participants}
      />

      {/* Wallet Modal */}
      <WalletModal
        isOpen={showWalletModal}
        onClose={() => setShowWalletModal(false)}
      />

      {/* Profile Edit Modal */}
      <ProfileEditModal
        isOpen={showProfileEditModal}
        onClose={handleCloseProfileEdit}
        onSubmit={handleSaveProfile}
        userData={userData}
      />

      {/* Bottom Navigation (replaces tabs) */}
      <nav className="user-bottom-nav" aria-label="Primary">
        <button className={`ub-nav-item ${activeTab==='available'?'active':''}`} onClick={()=>changeTab('available')}>
          <span className="ub-icon">🎯</span>
          <span className="ub-label">Available</span>
        </button>
        <button className={`ub-nav-item ${activeTab==='upcoming'?'active':''}`} onClick={()=>changeTab('upcoming')}>
          <span className="ub-icon">⏰</span>
          <span className="ub-label">Upcoming</span>
        </button>
        <button className={`ub-nav-item ${activeTab==='live'?'active':''}`} onClick={()=>changeTab('live')}>
          <span className="ub-icon">▶️</span>
          <span className="ub-label">Live</span>
        </button>
        <button className={`ub-nav-item ${activeTab==='completed'?'active':''}`} onClick={()=>changeTab('completed')}>
          <span className="ub-icon">🏆</span>
          <span className="ub-label">History</span>
        </button>
        <button className={`ub-nav-item ${activeTab==='dashboard'?'active':''}`} onClick={()=>changeTab('dashboard')}>
          <span className="ub-icon">📊</span>
          <span className="ub-label">Dashboard</span>
        </button>
        <button className={`ub-nav-item`} onClick={()=>setShowSupportModal(true)}>
          <span className="ub-icon">🛟</span>
          <span className="ub-label">Support</span>
        </button>
      </nav>
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

    {/* Support Modal */}
    <SupportModal
      isOpen={showSupportModal}
      onClose={() => setShowSupportModal(false)}
      defaultEmail={userData?.email || sessionStorage.getItem('userEmail') || ''}
          defaultPhone={userData?.phone || sessionStorage.getItem('userPhone') || ''}
    />
    </div>
  );
};

export default UserPage;
