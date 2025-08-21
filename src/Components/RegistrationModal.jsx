import React, { useState } from 'react';
import { registerForMatch } from '../utils/api';
import './RegistrationModal.css';

const RegistrationModal = ({ isOpen, onClose, match, onRegistrationSuccess }) => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Initialize players based on match type
  React.useEffect(() => {
    if (match && isOpen) {
      const playerCount = getPlayerCount(match.matchType);
      const initialPlayers = Array.from({ length: playerCount }, (_, index) => ({
        playerName: '',
        gameName: '',
        gameId: '',
        role: index === 0 ? 'LEADER' : 'MEMBER'
      }));
      setPlayers(initialPlayers);
    }
  }, [match, isOpen]);

  const getPlayerCount = (matchType) => {
    switch (matchType?.toUpperCase()) {
      case 'SOLO': return 1;
      case 'DUO': return 2;
  case 'SQUAD': return 4;
  case 'CLASH_SQUAD': return 4; // 4 per team
      default: return 1;
    }
  };

  const handlePlayerChange = (index, field, value) => {
    const updatedPlayers = [...players];
    // Enforce digits-only for Game ID
    const newValue = field === 'gameId' ? (value || '').replace(/\D+/g, '') : value;
    updatedPlayers[index][field] = newValue;
    setPlayers(updatedPlayers);
  };

  const isFormValid = () => {
    return players.every(player => 
      player.playerName.trim() && 
      player.gameName.trim() && 
      player.gameId.trim() && /^(\d)+$/.test(player.gameId)
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid()) {
      setError('Please fill all player details. Game ID must contain digits only.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await registerForMatch(match.id, players, 'wallet');
      onRegistrationSuccess(result);
      onClose();
    } catch (err) {
      const message = err?.message || 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !match) return null;

  const matchType = match.matchType?.toUpperCase() || 'SOLO';
  const playerLabels = {
    SOLO: ['Player'],
    DUO: ['Player 1 (You)', 'Player 2 (Partner)'],
    SQUAD: ['Player 1 (You)', 'Player 2', 'Player 3', 'Player 4'],
    CLASH_SQUAD: ['Player 1 (You)', 'Player 2', 'Player 3', 'Player 4']
  };

  return (
    <div className="registration-modal-overlay" onClick={handleOverlayClick}>
      <div className="registration-modal">
        <div className="registration-modal-header">
          <h2>Register for {match.title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="registration-modal-content">
          <div className="match-info">
            <div className="match-type-badge">{matchType}</div>
            <div className="match-details">
              <p><strong>Entry Fee:</strong> ₹{match.entryFee}</p>
              <p><strong>Prize Pool:</strong> ₹{match.prizePool}</p>
              {matchType === 'CLASH_SQUAD' && (
                <p><strong>Prize:</strong> Winner 
                  <span>
                    ₹{Math.round(((match.prizePool ?? 0) * 85) / 100)}
                  </span>
                </p>
              )}
              {match.rounds && (
                <p><strong>Rounds:</strong> {match.rounds}</p>
              )}
              <p><strong>Date:</strong> {new Date(match.scheduledAt || match.date).toLocaleString()}</p>
            </div>
          </div>

          {error && (
            <div className={`error-message ${error.includes('Insufficient wallet balance') ? 'balance-error' : ''}`}>
              {error}
              {error.includes('Insufficient wallet balance') && (
                <div className="balance-error-actions">
                  <button 
                    type="button" 
                    className="add-money-btn"
                    onClick={() => {
                      onClose(); // Close registration modal
                      // You could trigger wallet modal here if needed
                      // For now, user can manually click wallet button
                    }}
                  >
                    Add Money to Wallet
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="registration-form">
            {players.map((player, index) => (
              <div key={index} className="player-section">
                <h3>{playerLabels[matchType]?.[index] || `Player ${index + 1}`}</h3>
                <div className="input-group">
                  <label>Real Name:</label>
                  <input
                    type="text"
                    value={player.playerName}
                    onChange={(e) => handlePlayerChange(index, 'playerName', e.target.value)}
                    placeholder="Enter your real name"
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Game Name:</label>
                  <input
                    type="text"
                    value={player.gameName}
                    onChange={(e) => handlePlayerChange(index, 'gameName', e.target.value)}
                    placeholder="Enter in-game name"
                    required
                  />
                </div>
                <div className="input-group">
                  <label>Game ID :</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={player.gameId}
                    onChange={(e) => handlePlayerChange(index, 'gameId', e.target.value)}
                    placeholder="Enter numeric game ID"
                    title="Digits only"
                    required
                  />
                </div>
              </div>
            ))}

            <div className="registration-actions">
              <button type="button" onClick={onClose} className="cancel-btn">
                Cancel
              </button>
              <button 
                type="submit" 
                className="register-btn" 
                disabled={loading || !isFormValid()}
              >
                {loading ? 'Processing...' : `Pay ₹${match.entryFee} & Register`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegistrationModal;
