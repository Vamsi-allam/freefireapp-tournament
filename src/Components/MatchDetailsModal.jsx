import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import './MatchDetailsModal.css';
import { getPrizeDistribution } from '../utils/api';

const MatchDetailsModal = ({ isOpen, onClose, match, userRegistrations = [], participants = [] }) => {
  const { userData, isAuthenticated, role } = useSelector((state) => state.user);

  // Hooks must not be conditional; declare them before any early return
  const [prizeInfo, setPrizeInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Only admins should fetch prize distribution from the secure endpoint
        if (!match?.id || role !== 'ADMIN') return;
        const data = await getPrizeDistribution(match.id);
        if (!cancelled) setPrizeInfo(data);
      } catch (e) {
        if (!cancelled) setPrizeInfo(null);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [match?.id, role]);

  // Now it's safe to exit early without changing hooks order
  if (!isOpen || !match) return null;

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
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

  const getMatchTypeInfo = (matchType) => {
    switch (matchType?.toUpperCase()) {
      case 'SOLO':
        return { players: '1 Player', teamSize: '48 Solo Players', description: 'Individual battle royale match' };
      case 'DUO':
        return { players: '2 Players', teamSize: '24 Teams (48 Players)', description: 'Team up with 1 partner' };
      case 'SQUAD':
        return { players: '4 Players', teamSize: '12 Teams (48 Players)', description: 'Team up with 3 friends' };
      case 'CLASH_SQUAD':
        return { players: '4 Players', teamSize: '2 Teams (4v4)', description: 'Clash Squad 4v4 mode' };
      default:
        return { players: 'Unknown', teamSize: 'Unknown', description: 'Match details' };
    }
  };

  // Check if user is registered for this match
  const isUserRegistered = isAuthenticated && userRegistrations.some(
    reg => {
      // Handle both matchId and match.id structure
      const matchId = reg.matchId || reg.match?.id;
      const isRegisteredForThisMatch = matchId === match.id && reg.status === 'CONFIRMED';
      
      // Debug logging
      
      
      return isRegisteredForThisMatch;
    }
  );


  // Check if room details should be shown (5 minutes before match start)
  const shouldShowRoomDetails = () => {
    if (!isUserRegistered) return false;
    if (!match.roomId && !match.roomPassword) return false;
    
    const matchTime = new Date(match.scheduledAt || match.date);
    const now = new Date();
    const timeDifference = matchTime.getTime() - now.getTime();
    const minutesUntilMatch = Math.floor(timeDifference / (1000 * 60));
    
    
    // Show room details 5 minutes before match or if match has already started
    return minutesUntilMatch <= 4;
  };

  // Get time until room details are available (threshold: 5 minutes before start)
  const getTimeUntilRoomDetails = () => {
    const matchTime = new Date(match.scheduledAt || match.date);
    const now = new Date();
    const timeDifference = matchTime.getTime() - now.getTime();
    const minutesUntilMatch = Math.floor(timeDifference / (1000 * 60));

    // Already within the 5-minute window (or started)
    if (minutesUntilMatch <= 5) return null;

    // Time remaining until credentials become visible
    const minutesUntilVisibility = minutesUntilMatch - 5;
    const hours = Math.floor(minutesUntilVisibility / 60);
    const minutes = minutesUntilVisibility % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutesUntilVisibility}m`;
  };

  const matchTypeInfo = getMatchTypeInfo(match.matchType);
  const progressPercentage = (match.registeredTeams / match.slots) * 100;

  // Compute status badge similar to UserPage cards
  const computeStatusBadge = () => {
    const statusUpper = (match.status || '').toString().toUpperCase();
    // Terminal states
    if (statusUpper === 'CANCELLED') return { label: 'CANCELLED', className: 'cancelled' };
    if (statusUpper === 'COMPLETED') return { label: 'COMPLETED', className: 'completed' };

    // If slots are full, show FULL regardless of OPEN/UPCOMING
    const isFull = Number(match.registeredTeams || 0) >= Number(match.slots || 0);
    if (isFull && (statusUpper === 'OPEN' || statusUpper === 'UPCOMING' || !statusUpper)) {
      return { label: 'FULL', className: 'full' };
    }

    // Parse schedule and compute minutes until match
    const nowTs = Date.now();
    const parsed = Date.parse(match.scheduledAt || match.date || '');
    const scheduledMs = isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
    const minutesUntilMatch = Math.floor((scheduledMs - nowTs) / (1000 * 60));

    // Live if backend says LIVE, or within time-based live window
    if (statusUpper === 'LIVE' || (minutesUntilMatch <= 0 && minutesUntilMatch > -90)) {
      return { label: 'LIVE', className: 'live' };
    }

    // Registration closed window (7 minutes before start), only for OPEN/UPCOMING
    if (scheduledMs !== Number.POSITIVE_INFINITY && (statusUpper === 'OPEN' || statusUpper === 'UPCOMING')) {
      const registrationCloseMs = scheduledMs - 7 * 60 * 1000;
      if (nowTs >= registrationCloseMs) {
        return { label: 'CLOSED', className: 'closed' };
      }
    }

    // Default to existing status
    if (statusUpper === 'UPCOMING') return { label: 'UPCOMING', className: 'upcoming' };
    return { label: statusUpper || 'OPEN', className: (statusUpper || 'OPEN').toLowerCase() };
  };
  const statusBadge = computeStatusBadge();

  // Find current user's registration for this match (to reveal only their slot)
  const myRegistration = isUserRegistered
    ? userRegistrations.find(r => (r.matchId || r.match?.id) === match.id && r.status === 'CONFIRMED')
    : null;
  const myRegId = myRegistration?.id;
  const mySlotNumber = myRegistration?.slotNumber;
  const visibleParticipants = (isUserRegistered && (myRegId || mySlotNumber))
    ? (participants || []).filter(reg => (myRegId && reg.id === myRegId) || (mySlotNumber && reg.slotNumber === mySlotNumber))
    : [];

  // prizeInfo state/effect defined above

  return (
    <div className="match-details-modal-overlay" onClick={handleOverlayClick}>
      <div className="match-details-modal">
        <div className="match-details-header">
          <div className="match-title-section">
            <h2>{match.title}</h2>
            <div className="match-badges">
              <span className={`match-type-badge ${match.matchType?.toLowerCase()}`}>
                {match.matchType?.toUpperCase()}
              </span>
              <span className={`match-status-badge ${statusBadge.className}`}>
                {statusBadge.label}
              </span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="match-details-content">
          {/* Match Overview */}
          <div className="details-section">
            <h3>📋 Match Overview</h3>
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Game:</span>
                <span className="detail-value">{match.game || 'Free Fire'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Match Type:</span>
                <span className="detail-value">{matchTypeInfo.description}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Players per Team:</span>
                <span className="detail-value">{matchTypeInfo.players}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Total Capacity:</span>
                <span className="detail-value">{matchTypeInfo.teamSize}</span>
              </div>
            </div>
          </div>

          {/* Schedule & Timing */}
          <div className="details-section">
            <h3>🕒 Schedule & Timing</h3>
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Date & Time:</span>
                <span className="detail-value highlight">{formatDate(match.scheduledAt || match.date)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Map:</span>
                <span className="detail-value">{match.mapName || 'Bermuda'}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Game Mode:</span>
                <span className="detail-value">{match.gameMode || match.matchType}</span>
              </div>
              {match.matchType?.toUpperCase() === 'CLASH_SQUAD' && match.rounds && (
                <div className="detail-item">
                  <span className="detail-label">Rounds:</span>
                  <span className="detail-value">{match.rounds}</span>
                </div>
              )}
            </div>
          </div>

          {/* Prize & Entry */}
          <div className="details-section">
            <h3>💰 Prize & Entry Details</h3>
            <div className="prize-details">
              <div className="prize-item main-prize">
                <span className="prize-label">Entry Fee</span>
                <span className="prize-amount">₹{match.entryFee}</span>
              </div>
              <div className="prize-item main-prize">
                <span className="prize-label">Configured Pool</span>
                <span className="prize-amount total">₹{match.prizePool}</span>
              </div>
              {prizeInfo && (
                <div className="prize-item main-prize">
                  <span className="prize-label">Distributable</span>
                  <span className="prize-amount total">₹{prizeInfo.toBeDistributed}</span>
                </div>
              )}
            </div>
            <div className="prize-breakdown">
              <h4>Prize Distribution:</h4>
              {(() => {
                const t = (match.matchType || '').toUpperCase();
                if (t === 'SOLO') {
                  const perKill = Math.round((Number(match.entryFee) || 0) * 0.8);
                  return (
                    <div>
                      <div className="prize-positions">
                        <div className="position-prize first">
                          <span className="position">Per Kill</span>
                          <span className="amount">₹{perKill}</span>
                        </div>
                      </div>
                      <div className="prize-note" style={{marginTop:'6px', opacity:.85}}>
                        SOLO prizes are based on kills, not finishing position.
                      </div>
                    </div>
                  );
                }
                if (t === 'DUO') {
                  const totalPool = Number(match.prizePool || 0);
                  const pct = [0.40, 0.30, 0.20, 0.05, 0.05];
                  const money = pct.map(p => Math.round(totalPool * p));
                  return (
                    <div className="prize-positions">
                      <div className="position-prize first">
                        <span className="position">🥇 1st</span>
                        <span className="amount">₹{money[0]}</span>
                      </div>
                      <div className="position-prize second">
                        <span className="position">🥈 2nd</span>
                        <span className="amount">₹{money[1]}</span>
                      </div>
                      <div className="position-prize third">
                        <span className="position">🥉 3rd</span>
                        <span className="amount">₹{money[2]}</span>
                      </div>
                      <div className="position-prize">
                        <span className="position">4th</span>
                        <span className="amount">₹{money[3]}</span>
                      </div>
                      <div className="position-prize">
                        <span className="position">5th</span>
                        <span className="amount">₹{money[4]}</span>
                      </div>
                    </div>
                  );
                }
                if (t === 'CLASH_SQUAD') {
                  const totalPool = Number(match.prizePool || 0);
                  const winnerPrize = Math.round(totalPool);
                  return (
                    <div className="prize-positions">
                      <div className="position-prize first">
                        <span className="position">🥇 Winner</span>
                        <span className="amount">₹{winnerPrize}</span>
                      </div>
                    </div>
                  );
                }
                // SQUAD and others: Top 3 (40/30/20)
                const totalPool = Number(match.prizePool || 0);
                const money = [0.40, 0.30, 0.20].map(p => Math.round(totalPool * p));
                return (
                  <div className="prize-positions">
                    <div className="position-prize first">
                      <span className="position">🥇 1st</span>
                      <span className="amount">₹{money[0]}</span>
                    </div>
                    <div className="position-prize second">
                      <span className="position">🥈 2nd</span>
                      <span className="amount">₹{money[1]}</span>
                    </div>
                    <div className="position-prize third">
                      <span className="position">🥉 3rd</span>
                      <span className="amount">₹{money[2]}</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Registration Status */}
          <div className="details-section">
            <h3>👥 Registration Status</h3>
            <div className="registration-status">
              <div className="slots-info">
                <span className="registered">{match.registeredTeams}</span>
                <span className="separator">/</span>
                <span className="total">{match.slots}</span>
                <span className="label">Teams Registered</span>
              </div>
              <div className="progress-container">
                <div className="progress-bar-details">
                  <div 
                    className="progress-fill-details" 
                    style={{ width: `${progressPercentage}%` }}
                  ></div>
                </div>
                <span className="progress-text">{Math.round(progressPercentage)}% Full</span>
              </div>
              {match.slots - match.registeredTeams > 0 ? (
                <div className="availability-status available">
                  <span className="status-icon">✅</span>
                  <span>{match.slots - match.registeredTeams} slots available</span>
                </div>
              ) : (
                <div className="availability-status full">
                  <span className="status-icon">🚫</span>
                  <span>Match is full</span>
                </div>
              )}
            </div>
          </div>

      {/* Allocated Slots (Participants) - visible only to registered user and only their own slot */}
      {isUserRegistered && visibleParticipants && visibleParticipants.length > 0 && (
            <div className="details-section">
              <h3>🧾 Allocated Slots</h3>
              <div className="participants-grid">
        {visibleParticipants.sort((a,b)=>a.slotNumber-b.slotNumber).map(reg => (
                  <div key={reg.id} className="participant-slot">
                    <div className="slot-badge">Slot #{reg.slotNumber}</div>
                    <div className="participant-body">
                      {reg.players && reg.players.length>0 ? (
                        <ul className="participant-players">
                            {reg.players.sort((p1,p2)=>p1.position-p2.position).map((p, idx) => (
                              <li key={`${reg.id}-${p.position ?? idx}`} className="participant-player-line">
                              <span className="pp-name">{p.gameName || p.playerName}</span>
                              {p.gameId && <span className="pp-id"> (ID: {p.gameId})</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="participant-empty">No players</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rules & Guidelines */}
          {match.rules && (
            <div className="details-section">
              <h3>📜 Rules & Guidelines</h3>
              <div className="rules-content">
                <p>{match.rules}</p>
              </div>
            </div>
          )}

          {/* Room Credentials (if available and conditions met) */}
          {isUserRegistered && (
            <div className="details-section room-credentials">
              <h3>🎮 Room Details</h3>
              {(match.roomId || match.roomPassword) ? (
                shouldShowRoomDetails() ? (
                  <div className="room-info">
                    {match.roomId && (
                      <div className="room-detail">
                        <span className="room-label">Room ID:</span>
                        <span className="room-value">{match.roomId}</span>
                      </div>
                    )}
                    {match.roomPassword && (
                      <div className="room-detail">
                        <span className="room-label">Password:</span>
                        <span className="room-value">{match.roomPassword}</span>
                      </div>
                    )}
                    <div className="room-note available">
                      <span className="note-icon">✅</span>
                      <span>Room details are now available! Join the room 5 minutes before the match starts.</span>
                    </div>
                  </div>
                ) : (
                  <div className="room-info">
                    <div className="room-details-locked">
                      <div className="lock-icon">🔒</div>
                      <h4>Room Details Locked</h4>
                      <p>Room ID and password will be available 5 minutes before the match starts.</p>
                      {getTimeUntilRoomDetails() && (
                        <div className="countdown-info">
                          <span className="countdown-label">Available in:</span>
                          <span className="countdown-time">{getTimeUntilRoomDetails()}</span>
                        </div>
                      )}
                    </div>
                    <div className="room-note locked">
                      <span className="note-icon">ℹ️</span>
                      <span>You will receive room details 5 minutes before the match starts. Make sure to be online!</span>
                    </div>
                  </div>
                )
              ) : (
                <div className="room-info">
                  <div className="room-details-locked">
                    <div className="lock-icon">⏳</div>
                    <h4>Room Details Not Set</h4>
                    <p>The administrator hasn't set the room credentials yet. They will be available before the match starts.</p>
                  </div>
                  <div className="room-note pending">
                    <span className="note-icon">⏰</span>
                    <span>Room credentials will be added by the administrator before the match. Check back later!</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Room Details Info for Non-Registered Users */}
          {!isUserRegistered && (
            <div className="details-section room-credentials-info">
              <h3>🎮 Room Details</h3>
              <div className="room-info">
                <div className="room-details-locked">
                  <div className="lock-icon">🔒</div>
                  <h4>Register to Access Room Details</h4>
                  <p>Room ID and password are only available to registered players, 5 minutes before the match starts.</p>
                </div>
                <div className="room-note register-required">
                  <span className="note-icon">⚠️</span>
                  <span>You must register for this tournament to receive room credentials.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="close-modal-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default MatchDetailsModal;
