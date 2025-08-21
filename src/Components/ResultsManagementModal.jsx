import React, { useState, useEffect, useRef } from 'react';
import { 
    getMatchParticipants, 
    updateMatchResult, 
    getPrizeDistribution, 
    creditAllPrizes 
} from '../utils/api.js';
import './ResultsManagementModal.css';
import { Snackbar, Alert, Button } from '@mui/material';

const ResultsManagementModal = ({ isOpen, onClose, matchData, onPrizesCredited }) => {
    const [participants, setParticipants] = useState([]);
    const [prizeDistribution, setPrizeDistribution] = useState(null);
    const [loading, setLoading] = useState(false);
    const [showPrizePreview, setShowPrizePreview] = useState(false);
    const [updatingResults, setUpdatingResults] = useState({});
    const [bulkUpdating, setBulkUpdating] = useState(false);
    const [rowEdits, setRowEdits] = useState({});
    const [snack, setSnack] = useState({ open: false, message: '', type: 'info' });
    const openSnack = (message, type = 'info') => setSnack({ open: true, message, type });
    const closeSnack = () => setSnack(s => ({ ...s, open: false }));
    const [confirmCreditOpen, setConfirmCreditOpen] = useState(false);
    // Container ref used by inline confirm overlay
    const modalContainerRef = useRef(null);

    useEffect(() => {
        if (isOpen && matchData) {
            loadParticipants();
        }
    }, [isOpen, matchData]);

    const loadParticipants = async () => {
        setLoading(true);
        try {
            const data = await getMatchParticipants(matchData.id);
                        setParticipants(data);
                        // seed edits
                        const seed = Object.fromEntries((data || []).map(p => [p.registrationId, {
                            position: p.position ?? null,
                            kills: p.kills ?? 0
                        }]));
                        setRowEdits(seed);
        } catch (error) {
            console.error('Failed to load participants:', error);
            openSnack('Failed to load participants', 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadPrizeDistribution = async () => {
        try {
            const data = await getPrizeDistribution(matchData.id);
            setPrizeDistribution(data);
        } catch (error) {
            console.error('Failed to load prize distribution:', error);
            openSnack('Failed to load prize distribution', 'error');
        }
    };

    const setEditField = (participantId, field, value) => {
        setRowEdits(prev => ({
            ...prev,
            [participantId]: { ...prev[participantId], [field]: value }
        }));
    };

    const handleRowUpdate = async (participantId) => {
        const participant = participants.find(p => p.registrationId === participantId);
        if (!participant) return;
        const edit = rowEdits[participantId] || {};

        const matchType = (matchData?.matchType || '').toUpperCase();
        const payload = {
            registrationId: participantId,
            position: matchType === 'SOLO' ? null : (edit.position === '' || edit.position === undefined ? null : parseInt(edit.position, 10)),
            kills: edit.kills === '' || edit.kills === undefined ? null : parseInt(edit.kills, 10)
        };

        setUpdatingResults(prev => ({ ...prev, [participantId]: true }));
        try {
            const updatedResult = await updateMatchResult(matchData.id, payload);
            // Update local row first for snappy UI
            setParticipants(prev => prev.map(p => p.registrationId === participantId ? { ...p, ...updatedResult } : p));
            setRowEdits(prev => ({ ...prev, [participantId]: { position: updatedResult.position ?? null, kills: updatedResult.kills ?? 0 } }));
            // Then refresh from server to ensure consistency and avoid cascading display issues
            await loadParticipants();
            // If preview is open, refresh it too to reflect the latest edit
            if (showPrizePreview) {
                await loadPrizeDistribution();
            }
        } catch (error) {
            console.error('Failed to update result:', error);
            openSnack('Failed to update result', 'error');
        } finally {
            setUpdatingResults(prev => ({ ...prev, [participantId]: false }));
        }
    };

    const handlePrizePreview = async () => {
        setShowPrizePreview(true);
        // First compute a local preview using current edits (no need to save to DB)
        const local = computeLocalDistribution();
        setPrizeDistribution(local);
        // Then try server distribution; if it's non-zero, prefer it, else keep local
        try {
            const server = await getPrizeDistribution(matchData.id);
            const serverSum = Number(server?.toBeDistributed || 0);
            const localSum = Number(local?.toBeDistributed || 0);
            if (serverSum > 0 || (server?.distributions || []).some(d => (d.prizeAmount || 0) > 0)) {
                setPrizeDistribution(server);
            } else if (localSum >= 0) {
                setPrizeDistribution(local);
            }
        } catch (e) {
            // keep local on error
        }
    };

    const handleBulkUpdate = async () => {
        const matchType = (matchData?.matchType || '').toUpperCase();
        const editable = participants.filter(p => !p.prizeCredited);
        if (editable.length === 0) {
            openSnack('Nothing to update', 'warning');
            return;
        }
        // Only update rows where values changed
        const changed = editable.filter(p => {
            const edit = rowEdits[p.registrationId] || {};
            const currentPos = p.position ?? null;
            const currentKills = p.kills ?? 0;
            const nextPos = matchType === 'SOLO' ? null : (edit.position === '' || edit.position === undefined ? null : parseInt(edit.position, 10));
            const nextKills = edit.kills === '' || edit.kills === undefined ? 0 : parseInt(edit.kills, 10);
            return nextPos !== currentPos || nextKills !== currentKills;
        });
        if (changed.length === 0) {
            openSnack('No changes to update', 'info');
            return;
        }
        setBulkUpdating(true);
        try {
            const tasks = changed.map(p => {
                const edit = rowEdits[p.registrationId] || {};
                const payload = {
                    registrationId: p.registrationId,
                    position: matchType === 'SOLO' ? null : (edit.position === '' || edit.position === undefined ? null : parseInt(edit.position, 10)),
                    kills: edit.kills === '' || edit.kills === undefined ? 0 : parseInt(edit.kills, 10)
                };
                return updateMatchResult(matchData.id, payload);
            });
            const results = await Promise.allSettled(tasks);
            const ok = results.filter(r => r.status === 'fulfilled').length;
            const fail = results.length - ok;
            await loadParticipants();
            if (showPrizePreview) {
                await loadPrizeDistribution();
            }
            openSnack(`Updated ${ok} participant(s)` + (fail ? `, ${fail} failed` : ''), fail ? 'warning' : 'success');
        } catch (e) {
            console.error('Bulk update failed', e);
            openSnack('Bulk update failed: ' + (e?.message || 'Unknown error'), 'error');
        } finally {
            setBulkUpdating(false);
        }
    };

    const handleCreditAllPrizes = async () => {
        setLoading(true);
        try {
            // 1) Auto-save any unsaved edits first (only for not-yet-credited rows)
            const mt = (matchData?.matchType || '').toUpperCase();
            const editable = participants.filter(p => !p.prizeCredited);
            const changed = editable.filter(p => {
                const edit = rowEdits[p.registrationId] || {};
                const currentPos = p.position ?? null;
                const currentKills = p.kills ?? 0;
                const nextPos = mt === 'SOLO' ? null : (edit.position === '' || edit.position === undefined ? null : parseInt(edit.position, 10));
                const nextKills = edit.kills === '' || edit.kills === undefined ? 0 : parseInt(edit.kills, 10);
                return nextPos !== currentPos || nextKills !== currentKills;
            });
            if (changed.length > 0) {
                openSnack(`Saving ${changed.length} result change(s) before crediting...`, 'info');
                const tasks = changed.map(p => {
                    const edit = rowEdits[p.registrationId] || {};
                    const payload = {
                        registrationId: p.registrationId,
                        position: mt === 'SOLO' ? null : (edit.position === '' || edit.position === undefined ? null : parseInt(edit.position, 10)),
                        kills: edit.kills === '' || edit.kills === undefined ? 0 : parseInt(edit.kills, 10)
                    };
                    return updateMatchResult(matchData.id, payload);
                });
                const results = await Promise.allSettled(tasks);
                const fail = results.filter(r => r.status === 'rejected').length;
                if (fail > 0) {
                    openSnack(`Saved with ${fail} failure(s). Please review and retry.`, 'warning');
                }
            }
            // 2) Credit prizes
            const result = await creditAllPrizes(matchData.id);
            openSnack(result || 'Prizes credited', 'success');
            await loadPrizeDistribution(); // Refresh to show updated status
            await loadParticipants(); // Refresh participants to show updated credit status
            if (typeof onPrizesCredited === 'function') {
                onPrizesCredited();
            }
        } catch (error) {
            console.error('Failed to credit prizes:', error);
            openSnack('Failed to credit prizes', 'error');
        } finally {
            setLoading(false);
            setConfirmCreditOpen(false);
        }
    };

    // Helpers (defined before hooks/returns to allow usage everywhere)
    const matchType = (matchData?.matchType || '').toUpperCase();
    const isSolo = matchType === 'SOLO';
    const perKillRate = Math.round((matchData?.entryFee || 0) * 0.8);
    const computeToDistribute = () => {
        try {
            const entry = Number(matchData?.entryFee || 0);
            if (!participants || participants.length === 0) return 0;
            if (matchType === 'SOLO') {
                const totalKills = participants.reduce((s, p) => s + (Number(p.kills) || 0), 0);
                return perKillRate * totalKills;
            }
            const pool = entry * participants.length;
            if (matchType === 'DUO') {
                const percents = [0.40, 0.30, 0.20, 0.05, 0.05];
                return participants.reduce((sum, p) => {
                    const pos = Number(p.position) || 0;
                    if (pos >= 1 && pos <= 5) return sum + Math.round(pool * percents[pos - 1]);
                    return sum;
                }, 0);
            }
            if (matchType === 'CLASH_SQUAD') {
                const hasWinner = participants.some(p => (Number(p.position) || 0) === 1);
                return hasWinner ? Math.round(pool) : 0;
            }
            // SQUAD & others
            const percents = [0.40, 0.30, 0.20];
            return participants.reduce((sum, p) => {
                const pos = Number(p.position) || 0;
                if (pos >= 1 && pos <= 3) return sum + Math.round(pool * percents[pos - 1]);
                return sum;
            }, 0);
        } catch {
            return 0;
        }
    };

    const winnersSetCount = (() => {
        if (isSolo) return participants.filter(p => (Number(p.kills) || 0) > 0).length;
        if (matchType === 'DUO') return participants.filter(p => (Number(p.position) || 0) > 0 && p.position <= 5).length;
        if (matchType === 'CLASH_SQUAD') return participants.some(p => (Number(p.position) || 0) === 1) ? 1 : 0;
        return participants.filter(p => (Number(p.position) || 0) > 0 && p.position <= 3).length;
    })();

    // Build a local distribution object using current UI edits (without persisting)
    const computeLocalDistribution = () => {
        try {
            const entry = Number(matchData?.entryFee || 0);
            const teams = participants.map(p => {
                const edit = rowEdits[p.registrationId] || {};
                const pos = isSolo ? null : (edit.position === '' || edit.position === undefined ? p.position ?? null : parseInt(edit.position, 10));
                const kills = edit.kills === '' || edit.kills === undefined ? (p.kills ?? 0) : parseInt(edit.kills, 10);
                return { ...p, position: pos, kills };
            });
            // Compute prize pool
            let pool = Number(matchData?.prizePool || 0);
            if (!pool || pool <= 0) {
                const rate = isSolo ? 0.80 : matchType === 'CLASH_SQUAD' ? 0.85 : 0.90;
                pool = Math.round(entry * teams.length * rate);
            }

            let distributions = [];
            if (isSolo) {
                const perKill = Math.round(entry * 0.8);
                distributions = teams.map(t => ({
                    registrationId: t.registrationId,
                    playerId: t.playerId,
                    playerName: t.playerName,
                    teamName: t.teamName,
                    kills: Number(t.kills || 0),
                    position: 0,
                    prizeAmount: (Number(t.kills || 0) * perKill) || 0,
                    alreadyCredited: !!t.prizeCredited,
                }));
            } else if (matchType === 'DUO') {
                const percents = [0.40, 0.30, 0.20, 0.05, 0.05];
                distributions = teams.map(t => {
                    const pos = Number(t.position || 0);
                    const prizeAmount = (pos >= 1 && pos <= 5) ? Math.round(pool * percents[pos - 1]) : 0;
                    return {
                        registrationId: t.registrationId,
                        playerId: t.playerId,
                        playerName: t.playerName,
                        teamName: t.teamName,
                        kills: Number(t.kills || 0),
                        position: pos,
                        prizeAmount,
                        alreadyCredited: !!t.prizeCredited,
                    };
                });
            } else if (matchType === 'CLASH_SQUAD') {
                const winner = teams.find(t => Number(t.position || 0) === 1);
                distributions = teams.map(t => ({
                    registrationId: t.registrationId,
                    playerId: t.playerId,
                    playerName: t.playerName,
                    teamName: t.teamName,
                    kills: Number(t.kills || 0),
                    position: Number(t.position || 0),
                    prizeAmount: winner && winner.registrationId === t.registrationId ? Math.round(pool) : 0,
                    alreadyCredited: !!t.prizeCredited,
                }));
            } else { // SQUAD & others
                const percents = [0.40, 0.30, 0.20];
                distributions = teams.map(t => {
                    const pos = Number(t.position || 0);
                    const prizeAmount = (pos >= 1 && pos <= 3) ? Math.round(pool * percents[pos - 1]) : 0;
                    return {
                        registrationId: t.registrationId,
                        playerId: t.playerId,
                        playerName: t.playerName,
                        teamName: t.teamName,
                        kills: Number(t.kills || 0),
                        position: pos,
                        prizeAmount,
                        alreadyCredited: !!t.prizeCredited,
                    };
                });
            }

            const toBeDistributed = distributions.reduce((s, d) => s + (Number(d.prizeAmount || 0)), 0);
            const winnersCount = distributions.filter(d => (d.prizeAmount || 0) > 0).length;
            const remaining = Math.max(0, Number(pool) - Number(toBeDistributed));

            return {
                totalPrizePool: Number(pool),
                toBeDistributed: Number(toBeDistributed),
                undistributedRemainder: Number(remaining),
                winnersCount: Number(winnersCount),
                distributions,
            };
        } catch {
            return { totalPrizePool: 0, toBeDistributed: 0, undistributedRemainder: 0, winnersCount: 0, distributions: [] };
        }
    };

    // Recompute local preview live when editing if preview is open (keep hooks before any early return)
    useEffect(() => {
        if (!showPrizePreview) return;
        const local = computeLocalDistribution();
        setPrizeDistribution(local);
    }, [showPrizePreview, rowEdits, participants]);

    // Backdrop click handler
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div className="results-modal" onClick={(e) => e.stopPropagation()} ref={modalContainerRef}>
                <div className="results-modal-header">
                    <div>
                        <h2>🏆 {matchData?.title} - Results Management</h2>
                        <p style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem' }}>
                            Update participant positions and kills, then distribute prizes
                        </p>
                    </div>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="results-modal-content">
                    {loading ? (
                        <div className="loading">Loading...</div>
                    ) : (
                        <>
                            {/* Match Statistics Cards */}
                            <div className="match-stats-grid">
                                <div className="stat-card">
                                    <div className="stat-icon match-type">�</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Match Type</div>
                                        <div className="stat-value">{matchData?.matchType || 'SOLO'}</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon prize-pool">�</div>
                                    <div className="stat-content">
                                        <div className="stat-label">To Distribute</div>
                                        <div className="stat-value">₹{prizeDistribution?.toBeDistributed ?? computeToDistribute()}</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon participants">👤</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Participants</div>
                                        <div className="stat-value">{participants.length}</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-icon winners">🏆</div>
                                    <div className="stat-content">
                                        <div className="stat-label">Winners Set</div>
                                        <div className="stat-value">{winnersSetCount}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="results-section">
                                <h3>Participants & Results</h3>
                                <div className="section-subtitle">
                                    { isSolo ? 'Update kills for each participant (SOLO prizes are per kill)'
                                             : 'Update finishing position and kills for each participant' }
                                </div>
                                                                <div className="participants-scroll">
                                                                    <div className={`participants-table ${isSolo ? 'table-solo' : 'table-team'}`}>
                                                                                                                    <div className="table-header">
                                                                                                                            <div className="col">Team Name</div>
                                                                                    <div className="col">Player Name</div>
                                                                                    <div className="col">Game Name</div>
                                                                                    <div className="col">Game ID</div>
                                                                                    {!isSolo && <div className="col">Position</div>}
                                                                                    <div className="col">Kills</div>
                                                                                    <div className="col">Prize</div>
                                                                                                                            <div className="col">Status</div>
                                                                            </div>
                                        {participants.map((p, idx) => {
                                                                                    const edit = rowEdits[p.registrationId] || { position: p.position ?? null, kills: p.kills ?? 0 };
                                            const posNum = Number(p.position) || 0;
                                            const killsNum = Number(p.kills) || 0;
                                            let eligible;
                                            if (isSolo) {
                                                eligible = killsNum > 0;
                                            } else if (matchType === 'DUO') {
                                                eligible = posNum >= 1 && posNum <= 5;
                                            } else if (matchType === 'CLASH_SQUAD') {
                                                eligible = posNum === 1;
                                            } else {
                                                // SQUAD & others
                                                eligible = posNum >= 1 && posNum <= 3;
                                            }
                                            return (
                                                <div key={`${p.registrationId}-${p.playerId || p.playerGameId || p.playerName || idx}`} className="table-row">
                                                                                                                                            <div className="col">{p.teamName}</div>
                                                                                                    <div className="col">{p.playerName}</div>
                                                                                                    <div className="col">{p.playerGameName || '-'}</div>
                                                                                                    <div className="col">{p.playerGameId || '-'}</div>
                                                                                                    {!isSolo && (
                                                                                                        <div className="col">
                                                                                                            <input type="number" value={edit.position ?? ''} min="1" max="50"
                                                                                                                                                        onChange={(e)=> setEditField(p.registrationId,'position', e.target.value)}
                                                                                                                                                        disabled={!!p.prizeCredited || !!updatingResults[p.registrationId]}
                                                                                                                                                    />
                                                                                                        </div>
                                                                                                    )}
                                                                                                    <div className="col">
                                                                                                        <input type="number" value={edit.kills ?? 0} min="0"
                                                                                                            onChange={(e)=> setEditField(p.registrationId,'kills', e.target.value)}
                                                                                                                                                    placeholder={isSolo ? 'Kills (payout per kill)' : 'Kills'}
                                                                                                                                                    disabled={!!p.prizeCredited || !!updatingResults[p.registrationId]}
                                                                                                                                                />
                                                                                                    </div>
                                                                                                    <div className="col">
                                                                                                        {isSolo
                                                                                                            ? `₹${Number(p.prizeAmount) || 0}`
                                                                                                            : (eligible && (Number(p.prizeAmount) || 0) > 0 ? `₹${p.prizeAmount}` : '-')}
                                                                                                    </div>
                                                                                                                                            <div className="col">
                                                                        {p.prizeCredited ? (
                                                                                                                                                    <span className="status-credited">✓ Credited</span>
                                                                                                                                                ) : eligible && (Number(p.prizeAmount)||0) > 0 ? (
                                                                                                                                                    <span className="status-pending">Pending</span>
                                                                                                                                                ) : (
                                                                                                                                                    <span className="status-none">-</span>
                                                                                                                                                )}
                                                                                                                                            </div>
                                                                                            </div>
                                                                                    );
                                                                            })}
                                                                    </div>
                                                                </div>
                            </div>

                                                        {(() => {
                                                            const anyEligible = participants.some(p => {
                                                                const posNum = Number(p.position) || 0;
                                                                const killsNum = Number(p.kills) || 0;
                                                                if (isSolo) return killsNum > 0;
                                                                if (matchType === 'DUO') return posNum >= 1 && posNum <= 5;
                                                                if (matchType === 'CLASH_SQUAD') return posNum === 1;
                                                                return posNum >= 1 && posNum <= 3; // SQUAD & others
                                                            });

                                                            // Prefer prize preview info (server or local) if available
                                                            const previewHasPayables = !!(prizeDistribution && Array.isArray(prizeDistribution.distributions) &&
                                                                prizeDistribution.distributions.some(d => Number(d.prizeAmount || 0) > 0 && !d.alreadyCredited));

                                                            const participantHasPayables = participants.some(p => {
                                                                const posNum = Number(p.position) || 0;
                                                                const killsNum = Number(p.kills) || 0;
                                                                let eligible;
                                                                if (isSolo) {
                                                                    eligible = killsNum > 0;
                                                                } else if (matchType === 'DUO') {
                                                                    eligible = posNum >= 1 && posNum <= 5;
                                                                } else if (matchType === 'CLASH_SQUAD') {
                                                                    eligible = posNum === 1;
                                                                } else {
                                                                    eligible = posNum >= 1 && posNum <= 3; // SQUAD & others
                                                                }
                                                                return eligible && (Number(p.prizeAmount)||0) > 0 && !p.prizeCredited;
                                                            });

                                                            const canCredit = previewHasPayables || participantHasPayables;

                                                            return (
                                                                <div className="actions-section">
                                                                    <button className="preview-btn" onClick={handleBulkUpdate} disabled={loading || bulkUpdating}>↻ Update Results</button>
                                                                    <button className="preview-btn" onClick={handlePrizePreview} disabled={loading}>👁️ Preview Distribution</button>
                                                                    {/** Blur the trigger before opening to prevent focus being inside a soon-to-be aria-hidden subtree */}
                                                                    <button className="credit-btn" onClick={(e) => { e.currentTarget.blur(); setConfirmCreditOpen(true); }} disabled={loading || !canCredit}>💳 Credit All Prizes</button>
                                                                    {!anyEligible && (
                                                                        <div className="all-credited-note" style={{marginLeft:'12px'}}>Set results to enable crediting.</div>
                                                                    )}
                                                                    {anyEligible && !canCredit && (
                                                                        <div className="all-credited-note" style={{marginLeft:'12px'}}>
                                                                            No payable prizes yet. Use Preview to compute amounts, then credit.
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}

                            {showPrizePreview && prizeDistribution && (
                                <div className="prize-preview-section">
                                    <h3>Prize Distribution Preview</h3>
                                    <div className="prize-summary">
                                        <div className="summary-item">
                                            <div className="icon">💳</div>
                                            <label>Distribution Total</label>
                                            <span>₹{prizeDistribution.toBeDistributed}</span>
                                        </div>
                                        <div className="summary-item">
                                            <div className="icon">💰</div>
                                            <label>Total Prize Pool</label>
                                            <span>₹{prizeDistribution.totalPrizePool}</span>
                                        </div>
                                        <div className="summary-item">
                                            <div className="icon">🧮</div>
                                            <label>Remaining</label>
                                            <span>₹{prizeDistribution.undistributedRemainder}</span>
                                        </div>
                                        <div className="summary-item">
                                            <div className="icon">🏆</div>
                                            <label>Winners</label>
                                            <span>{prizeDistribution.winnersCount}</span>
                                        </div>
                                    </div>

                                    <div className="winners-list">
                                        <h4>Prize Distribution Details</h4>
                                        {isSolo && (
                                            <div style={{marginBottom:'8px', opacity:0.9}}>
                                                Per-kill rate: <strong>₹{perKillRate}</strong> (80% of entry fee)
                                            </div>
                                        )}
                                        {(prizeDistribution?.distributions || []).map((winner, idx) => (
                                            <div key={`dist-${winner.registrationId || winner.id || 'preview'}-${winner.playerId || winner.playerGameId || winner.playerName || idx}`} className="winner-item">
                                                <div className="winner-info">
                                                    {!isSolo ? (
                                                        <span className={`position ${
                                                            winner.position === 1 ? 'first-place' : 
                                                            winner.position === 2 ? 'second-place' : 
                                                            winner.position === 3 ? 'third-place' : 'other-place'
                                                        }`}>
                                                            #{winner.position}
                                                        </span>
                                                    ) : (
                                                        <span className="kills-badge">{winner.kills} Kills</span>
                                                    )}
                                                    <span className="name">{winner.playerName}</span>
                                                    <span className="team">{winner.teamName}</span>
                                                    {!isSolo && <span className="kills">{winner.kills} kills</span>}
                                                </div>
                                                <div className="winner-prize">
                                                    <span className="amount">₹{winner.prizeAmount}</span>
                                                    {winner.alreadyCredited && (
                                                        <span className="credited-badge">✓ Credited</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
            <Snackbar
                open={snack.open}
                autoHideDuration={3000}
                onClose={closeSnack}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={closeSnack} severity={snack.type} variant="filled" sx={{ width: '100%' }}>
                    {snack.message}
                </Alert>
            </Snackbar>
            {confirmCreditOpen && (
                <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
                    <div className="confirm-dialog" onClick={(e)=>e.stopPropagation()}>
                        <h3 id="confirm-title" className="confirm-title">Confirm Credit</h3>
                        <p className="confirm-text">Are you sure you want to credit all prizes? This action cannot be undone.</p>
                        <div className="confirm-actions">
                            <button className="btn-cancel" onClick={() => setConfirmCreditOpen(false)} disabled={loading}>Cancel</button>
                            <button className="btn-confirm" onClick={handleCreditAllPrizes} disabled={loading}>Credit All</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultsManagementModal;
