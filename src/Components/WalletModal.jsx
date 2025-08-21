import React, { useState, useEffect } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { updateProfile } from '../redux/userSlice';
import { supabase } from '../supabaseClient';
import { getWalletBalance, getTransactionHistory, addMoney, withdrawMoney, listMyUpiPayments, listMyWithdrawals, getUserRegistrations } from '../utils/api';
import AddMoneyModal from './AddMoneyModal';
import WithdrawModal from './WithdrawModal';
import ProfileCompletionModal from './ProfileCompletionModal';
import './WalletModal.css';

const WalletModal = ({ isOpen, onClose }) => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const dispatch = useDispatch();
  const { userData } = useSelector((state) => state.user);
  const [walletData, setWalletData] = useState({
    balance: 0,
    totalAdded: 0,
    totalSpent: 0,
    moneyAdded: 0,
  transactions: 0
  });
  
  const [activeSection, setActiveSection] = useState(() => {
    try { return sessionStorage.getItem('ui.wallet.activeSection') || 'history'; } catch { return 'history'; }
  }); // 'history' or 'analytics'
  const [transactionFilter, setTransactionFilter] = useState(() => {
    try {
      const v = sessionStorage.getItem('ui.wallet.transactionFilter') || 'all';
      return v === 'spent' ? 'prizes' : v;
    } catch { return 'all'; }
  }); // 'all', 'added', 'refunds', 'prizes', 'withdrawals'
  const [transactions, setTransactions] = useState([]);
  const [hasMoreTx, setHasMoreTx] = useState(true);
  const [upiPayments, setUpiPayments] = useState([]); // pending/approved/rejected
  const [withdrawals, setWithdrawals] = useState([]); // my withdrawal requests
  const [registrations, setRegistrations] = useState([]); // my match registrations to determine completion
  const [isLoading, setIsLoading] = useState(false);
  const [showAddMoneyModal, setShowAddMoneyModal] = useState(() => {
    try { return sessionStorage.getItem('ui.wallet.showAddMoneyModal') === 'true'; } catch { return false; }
  });
  const [showWithdrawModal, setShowWithdrawModal] = useState(() => {
    try { return sessionStorage.getItem('ui.wallet.showWithdrawModal') === 'true'; } catch { return false; }
  });
  const [showProfileCompletion, setShowProfileCompletion] = useState(false);
  const [profileCompleted, setProfileCompleted] = useState(false);
  // Snackbar
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });
  const openSnack = (message, severity = 'info') => setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack(s => ({ ...s, open: false }));

  // Check if user profile is complete
  const isProfileComplete = () => {
    return userData?.phone && userData?.gameId && userData?.name;
  };

  useEffect(() => {
    if (isOpen) {
      const currentProfileStatus = isProfileComplete();
      setProfileCompleted(currentProfileStatus);
      // Fire all network requests in parallel for speed
      Promise.allSettled([
        fetchWalletData(),
        fetchTransactions({ append: false, background: true }),
        fetchUpiPayments(),
        fetchWithdrawals(),
        fetchRegistrations()
      ]).catch(() => {});
    }
  }, [isOpen, userData]); // Added userData dependency to re-check when user data changes

  // Realtime: subscribe to wallet balance, transactions, UPI payments, and withdrawals for the current user when modal is open
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    let unsubscribe = null;
    let debounceId = null;

    const scheduleRefresh = () => {
      if (debounceId) clearTimeout(debounceId);
  debounceId = setTimeout(async () => {
        if (!mounted) return;
        try {
          await Promise.allSettled([
            fetchWalletData(),
    fetchTransactions({ append: false, background: true }),
    fetchUpiPayments(),
    fetchWithdrawals()
          ]);
        } catch {}
      }, 250);
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid) return;

        const ch = supabase
          .channel(`wallet-realtime-${uid}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'upi_payments', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals', filter: `user_id=eq.${uid}` }, scheduleRefresh)
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR') console.warn('[wallet realtime] channel error');
            if (status === 'TIMED_OUT') console.warn('[wallet realtime] timed out; retrying');
          });

        unsubscribe = () => { try { supabase.removeChannel(ch); } catch {} };
      } catch {}
    })();

    return () => {
      mounted = false;
      if (debounceId) clearTimeout(debounceId);
      if (unsubscribe) { try { unsubscribe(); } catch {} }
    };
  }, [isOpen]);

  // Reset modal states when wallet modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowAddMoneyModal(false);
      setShowWithdrawModal(false);
      setShowProfileCompletion(false);
    }
  }, [isOpen]);

  // Persist UI state for refresh continuity
  useEffect(() => {
  try { sessionStorage.setItem('ui.wallet.activeSection', activeSection); } catch {}
  }, [activeSection]);
  useEffect(() => {
  try { sessionStorage.setItem('ui.wallet.transactionFilter', transactionFilter); } catch {}
  }, [transactionFilter]);
  useEffect(() => {
  try { sessionStorage.setItem('ui.wallet.showAddMoneyModal', String(showAddMoneyModal)); } catch {}
  }, [showAddMoneyModal]);
  useEffect(() => {
  try { sessionStorage.setItem('ui.wallet.showWithdrawModal', String(showWithdrawModal)); } catch {}
  }, [showWithdrawModal]);

  const fetchWalletData = async () => {
    try {
      const data = await getWalletBalance();
      setWalletData(prev => ({
        ...prev,
        balance: data.balance || 0
      }));
    } catch (error) {
      console.error("Failed to fetch wallet data:", error);
    }
  };

  const PAGE_SIZE = 50;
  const fetchTransactions = async ({ append = false, background = false } = {}) => {
    try {
      if (!background) setIsLoading(true);
      const before = append && transactions.length ? transactions[transactions.length - 1].createdAt : undefined;
      const data = await getTransactionHistory({ limit: PAGE_SIZE, before });
      if (append) {
        const existing = new Set((transactions || []).map(t => t.id));
        const merged = [...transactions];
        for (const t of (data || [])) if (!existing.has(t.id)) merged.push(t);
        setTransactions(merged);
      } else {
        // Avoid noisy re-renders if nothing changed at the top of the list
        const topIdsPrev = (transactions || []).slice(0, 10).map(t => t.id).join(',');
        const topIdsNext = (data || []).slice(0, 10).map(t => t.id).join(',');
        if (topIdsPrev !== topIdsNext) {
          setTransactions(data || []);
        }
      }
  setHasMoreTx((data || []).length >= PAGE_SIZE);

  // Removed transactions count chip; no need to maintain a separate count in state
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
      // Set empty transactions as fallback
      if (!append) setTransactions([]);
    } finally {
      if (!background) setIsLoading(false);
    }
  };

  // Recompute dashboard stats based on refined rules whenever data changes
  useEffect(() => {
    const txns = Array.isArray(transactions) ? transactions : [];

    // Build a quick lookup of UPI refs that are not yet credited (pending/rejected)
    const pendingOrRejectedUpiRefs = new Set(
      (upiPayments || [])
        .filter(p => {
          const st = String(p?.status || '').toUpperCase();
          return st === 'SUBMITTED' || st === 'UTR_SUBMITTED' || st === 'REJECTED' || st === 'PENDING';
        })
        .map(p => p && p.referenceId)
        .filter(Boolean)
    );

    const approvedUpiRefs = new Set(
      (upiPayments || [])
        .filter(p => {
          const st = String(p?.status || '').toUpperCase();
          return st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS';
        })
        .map(p => p && p.referenceId)
        .filter(Boolean)
    );

    // Helper: determine if a CREDIT is true add-money (exclude refunds/prizes)
    const isAddMoneyCredit = (t) => {
      if (!t || t.type !== 'CREDIT') return false;
      const ref = (t.referenceId || '').toString();
      const desc = (t.description || '').toString();
      // Exclude refunds and prizes
  // Exclude refunds and prizes; also exclude withdrawal references
  if (ref.startsWith('WRF_') || ref.startsWith('WITH_') || ref.startsWith('PRIZE_')) return false;
      // If this looks like a UPI credit but its payment is still pending/rejected, do NOT count it
      if (ref.startsWith('UPI_') && pendingOrRejectedUpiRefs.has(ref)) return false;
  // Include UPI add money ONLY when approved/credited
  if (ref.startsWith('UPI_')) return approvedUpiRefs.has(ref);
  // If description says UPI Add Money but we cannot tie to an approved ref, do not count
  if (/UPI\s+Add\s+Money/i.test(desc)) return ref ? approvedUpiRefs.has(ref) : false;
  // Non‑UPI gateways: allow generic phrases
  if (/Money added via|Add Money/i.test(desc)) return true;
      return false;
    };

    // Helper: extract match title from transaction description
    const extractTitle = (desc) => {
      if (!desc) return '';
      const s = desc.toString();
      const prefix = 'Tournament Registration - ';
      if (s.startsWith(prefix)) return s.slice(prefix.length).trim();
      return s.trim();
    };

    // Helper: normalize titles for robust matching
    const normalizeTitle = (title) => {
      return (title || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')        // collapse whitespace
        .replace(/[^a-z0-9 ]/g, '')   // drop punctuation/specials
        .replace(/\s/g, '');          // remove spaces for compact key
    };

    // Completed matches set from registrations
    const completedRegs = (registrations || [])
      .filter(r => ((r?.match?.status || r?.status || '') + '').toUpperCase() === 'COMPLETED')
      .map(r => {
        const title = (r?.match?.title || r?.matchTitle || '').toString().trim();
        return {
          title,
          normTitle: normalizeTitle(title),
          amountPaid: Number(r?.amountPaid ?? 0),
          entryFee: Number(r?.match?.entryFee ?? 0)
        };
      })
      .filter(r => r.title);

    // Build set of refunded match titles from refund credits
    const refundedTitleKeys = new Set(
      txns
  .filter(t => t?.type === 'CREDIT' && typeof t?.referenceId === 'string' && (t.referenceId.startsWith('WRF_') || /Refund/i.test(String(t.description || ''))))
        .map(t => (t.description || '').toString())
        .map(desc => {
          // Expect formats like:
          //  - "Refund: Match cancelled due to low registrations - <title>"
          //  - "Refund: Match cancelled by admin - <title>"
          //  - "Refund for failed registration - <title>"
          const idx = desc.lastIndexOf(' - ');
          const title = idx >= 0 ? desc.slice(idx + 3).trim() : '';
          return normalizeTitle(title);
        })
        .filter(Boolean)
    );

    // Build debit buckets by normalized title from transaction history
    const debitBuckets = new Map(); // normTitle => number[] amounts
    txns
      .filter(t => t?.type === 'DEBIT' && typeof t?.referenceId === 'string' && t.referenceId.startsWith('TRN_'))
      .forEach(t => {
        const title = extractTitle(t.description);
        const key = normalizeTitle(title);
        if (!key) return;
        const list = debitBuckets.get(key) || [];
        list.push(Number(t.amount || 0));
        debitBuckets.set(key, list);
      });

    // Totals
    // Base: sum approved wallet credits
    let trueTotalAdded = txns
      .filter(isAddMoneyCredit)
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    // If an approved UPI exists but the corresponding wallet txn isn't present yet, include its amount
    const existingCreditRefs = new Set(
      txns.filter(t => t?.type === 'CREDIT').map(t => t.referenceId).filter(Boolean)
    );
    (upiPayments || []).forEach(p => {
      const st = String(p?.status || '').toUpperCase();
      const ref = p && p.referenceId;
      if (!ref || existingCreditRefs.has(ref)) return;
      if (st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS') {
        trueTotalAdded += Number(p.amount || 0);
      }
    });

    // Compute spent by iterating completed registrations and matching debits (exclude refunded)
    const filteredTotalSpent = completedRegs.reduce((sum, reg) => {
      if (!reg.normTitle || refundedTitleKeys.has(reg.normTitle)) return sum;
      const bucket = debitBuckets.get(reg.normTitle) || [];
      let amt = 0;
      if (bucket.length > 0) {
        amt = Number(bucket.shift() || 0); // consume one debit for this title
        debitBuckets.set(reg.normTitle, bucket);
      } else if (reg.amountPaid > 0) {
        amt = Number(reg.amountPaid);
      } else if (reg.entryFee > 0) {
        amt = Number(reg.entryFee);
      }
      return sum + amt;
    }, 0);

    // Profit: sum of admin-sent prize credits
    const profitTotal = txns
      .filter(t => t?.type === 'CREDIT' && typeof t?.referenceId === 'string' && t.referenceId.startsWith('PRIZE_'))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    // Count only completed (PAID) withdrawals in the dashboard
    const withdrawTotal = (withdrawals || [])
      .filter(w => String(w.status || '').toUpperCase() === 'PAID')
      .reduce((sum, w) => sum + Number(w.amount || 0), 0);

    setWalletData(prev => ({
      ...prev,
      trueTotalAdded,
      filteredTotalSpent,
  withdrawTotal,
  profitTotal
    }));
  }, [transactions, registrations, withdrawals, upiPayments]);

  const fetchUpiPayments = async () => {
    try {
      const data = await listMyUpiPayments();
      setUpiPayments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('Failed to load UPI payments:', e.message);
      setUpiPayments([]);
    }
  };

  const fetchWithdrawals = async () => {
    try {
      const data = await listMyWithdrawals();
      setWithdrawals(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('Failed to load withdrawals:', e.message);
      setWithdrawals([]);
    }
  };

  const fetchRegistrations = async () => {
    try {
      const data = await getUserRegistrations();
      setRegistrations(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('Failed to load registrations:', e.message);
      setRegistrations([]);
    }
  };

  const handleAddMoney = async (amount, paymentMethod) => {
    try {
      await addMoney(amount);
      await fetchWalletData(); // Refresh wallet data
      await fetchTransactions(); // Refresh transactions
    } catch (error) {
      console.error('Error adding money:', error);
      throw error;
    }
  };

  const handleAddMoneyClick = () => {
    // Check if profile is complete before showing add money modal
    const currentProfileStatus = isProfileComplete();
    if (!currentProfileStatus) {
      setShowProfileCompletion(true);
      setProfileCompleted(false);
    } else {
      setShowAddMoneyModal(true);
      setProfileCompleted(true);
    }
  };

  const handleProfileCompletion = async (profileData) => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) throw new Error('Not signed in');
      const payload = {
        id: uid,
        user_name: profileData.displayName || profileData.name,
        user_phone: profileData.phoneNumber,
        game_id: profileData.gameId,
      };
      const { data, error } = await supabase.from('profiles').upsert(payload).select('*').single();
      if (error) throw error;

      // Update session storage with new user data
      sessionStorage.setItem('userName', data.user_name || profileData.displayName || profileData.name || '');
      sessionStorage.setItem('userPhone', data.user_phone || profileData.phoneNumber || '');
      sessionStorage.setItem('userGameId', data.game_id || profileData.gameId || '');

      // Update Redux store with new profile data
      dispatch(updateProfile({
        displayName: data.user_name || profileData.displayName || profileData.name,
        phoneNumber: data.user_phone || profileData.phoneNumber,
        gameId: data.game_id || profileData.gameId,
      }));

      setProfileCompleted(true);
      setShowProfileCompletion(false);

      // Now show add money modal
      setTimeout(() => {
        setShowAddMoneyModal(true);
      }, 100);
    } catch (error) {
      console.error('Error completing profile:', error);
      openSnack('Failed to update profile. Please try again.', 'error');
    }
  };

  const handleWithdraw = async (transactionResult) => {
    try {
      // The withdrawal is already completed at this point (after OTP verification)
      // We just need to refresh the data
      await fetchWalletData(); // Refresh wallet data
  await fetchTransactions(); // Refresh transactions
  await fetchWithdrawals(); // Ensure pending withdrawal shows up
      
      // Show success message
      
    } catch (error) {
      console.error('Error updating wallet data after withdrawal:', error);
      // Even if refresh fails, the withdrawal was successful
      throw error;
    }
  };

  const getFilteredTransactions = () => {
    // Start with real wallet transactions
    let list = Array.isArray(transactions) ? [...transactions] : [];

    // Build a set/map of existing referenceIds to avoid duplicating shadow entries
    const existingRefs = new Set(
      list
        .map(t => t && t.referenceId)
        .filter(Boolean)
    );

    // Build a deduped UPI list: one row per reference/UTR with highest-precedence status
    const statusRank = (s) => {
      const st = String(s || '').toUpperCase();
      if (st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS') return 3;
      if (st === 'REJECTED') return 2;
      return 1; // PENDING, SUBMITTED, UTR_SUBMITTED, others
    };
    const minuteKey = (ts) => {
      try {
        const d = new Date(ts);
        if (!isFinite(d.getTime())) return null;
        // Use minute precision in UTC to minimize timezone flicker
        const iso = d.toISOString().slice(0,16); // YYYY-MM-DDTHH:MM
        return iso;
      } catch { return null; }
    };
    const makeKey = (p) => {
      if (!p) return null;
  const ref = p.referenceId && String(p.referenceId).trim();
      if (ref) return `REF:${ref}`;
      const utr = p.utr && String(p.utr).trim();
      if (utr) return `UTR:${utr}`;
  const bucket = minuteKey(p.updatedAt || p.createdAt);
      const amt = Number(p.amount || 0);
  if (bucket != null && amt > 0) return `B:${amt}|${bucket}`;
      return p.id ? `ID:${p.id}` : null;
    };
    const upiByKey = new Map(); // key -> best payment row
    (upiPayments || []).forEach((p) => {
      if (!p) return;
      const key = makeKey(p);
      if (!key) return;
      const current = upiByKey.get(key);
      if (!current || statusRank(p.status) >= statusRank(current.status)) {
        upiByKey.set(key, p);
      }
    });
    // Second pass: collapse by amount+minute key
    const byGroup = new Map(); // gKey -> best payment row
    const gKeyOf = (p) => {
      const ref = p.referenceId && String(p.referenceId).trim();
      if (ref) return `REF:${ref}`;
      const utr = p.utr && String(p.utr).trim();
      if (utr) return `UTR:${utr}`;
      const mk = minuteKey(p.updatedAt || p.createdAt);
      const amt = Number(p.amount || 0);
      if (mk && amt > 0) return `B:${amt}|${mk}`;
      return p.id ? `ID:${p.id}` : null;
    };
    Array.from(upiByKey.values()).forEach((p) => {
      const gKey = gKeyOf(p);
      if (!gKey) return;
      const cur = byGroup.get(gKey);
      if (!cur || statusRank(p.status) >= statusRank(cur.status)) {
        byGroup.set(gKey, p);
      }
    });
    const upiDedupList = Array.from(byGroup.values());
    // Map UPI by referenceId for annotation
    const upiByRef = new Map(
      upiDedupList.filter(p => p && p.referenceId).map(p => [p.referenceId, p])
    );

    // Helper to decide if a withdrawal is post-OTP
    const isOtpVerified = (w) => {
      const st = String(w?.status || '').toUpperCase();
      if (st === 'OTP_VERIFIED' || st === 'VERIFIED') return true;
      const d = w && (w.details || w.meta || {});
      return Boolean(
        d.otp_verified_at || d.otpVerifiedAt || d.otp_verified || d.otpVerified ||
        w?.otp_verified_at || w?.otpVerifiedAt || w?.otp_verified || w?.otpVerified
      );
    };

    // Gather references of real debit rows (wallet_transactions) to gate visibility
    const realDebitRefs = new Set(
      list
        .filter(t => t && t.type === 'DEBIT')
        .map(t => t.referenceId)
        .filter(Boolean)
    );

    // Build displayable withdrawals (post-OTP only unless PAID/REJECTED)
    const wdDisplay = (withdrawals || []).filter((w) => {
      const st = String(w.status || '').toUpperCase();
      if (st === 'CREATED' || st === 'OTP_SENT' || st === 'CANCELLED' || st === 'CANCELED') return false;
      if (st === 'PAID' || st === 'REJECTED') return true;
      // Show pending-like states only if OTP verified OR a real debit exists for this withdrawal
      const ref = (w.referenceId && String(w.referenceId).trim()) || `WREQ_${w.id}`;
      if (isOtpVerified(w)) return true;
      if (realDebitRefs.has(ref)) return true;
      return false;
    });

    const wdByRef = new Map(wdDisplay.map(w => {
      const ref = w.referenceId && String(w.referenceId).trim().length > 0 ? w.referenceId : `WREQ_${w.id}`;
      return [ref, w];
    }));

    // Add UPI Add Money shadow items (include pending/rejected and approved to render a single enriched row)
  const upiShadow = (upiDedupList || [])
      .filter(p => {
        const st = String(p?.status || '').toUpperCase();
        return (
          st === 'UTR_SUBMITTED' || st === 'SUBMITTED' || st === 'REJECTED' ||
          st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS' || st === 'PENDING'
        );
      })
      .map(p => ({
        id: `upi-${p.id}`,
        type: 'CREDIT',
        amount: p.amount,
        description: (() => {
          const st = String(p?.status || '').toUpperCase();
          let label = '(Pending Verification)';
          if (st === 'REJECTED') label = '(Rejected)';
          if (st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS') label = '(Credited)';
          return `UPI Add Money ${label}${p.utr ? ` (UTR: ${p.utr})` : ''}`;
        })(),
        referenceId: p.referenceId,
        // Use stable server timestamps only; avoid client now() which causes shifting items
        createdAt: p.createdAt || p.updatedAt || null,
        __upiStatus: p.status
      }));

    // Collapse shadow duplicates to a single row per payment
    (function collapseUpiShadow() {
      const minuteOf = (ts) => { try { const d = new Date(ts); if (!isFinite(d.getTime())) return null; return d.toISOString().slice(0,16); } catch { return null; } };
      const sRank = (s) => { const st = String(s||'').toUpperCase(); if (st==='APPROVED'||st==='CREDITED'||st==='PAID'||st==='SUCCESS') return 3; if (st==='REJECTED') return 2; return 1; };
      const keyOf = (u) => {
        if (u.referenceId) return `REF:${u.referenceId}`;
        if (u.description && /UTR:\s*([A-Za-z0-9]+)/.test(u.description)) return `UTR:${u.description.match(/UTR:\s*([A-Za-z0-9]+)/)[1]}`;
        const mk = minuteOf(u.createdAt);
        const amt = Number(u.amount||0);
        return (mk && amt>0) ? `B:${amt}|${mk}` : `ID:${u.id}`;
      };
      const best = new Map();
      upiShadow.forEach(u => {
        const k = keyOf(u);
        const cur = best.get(k);
        if (!cur || sRank(u.__upiStatus) >= sRank(cur.__upiStatus)) best.set(k, u);
      });
      // Replace with merged values
      // eslint-disable-next-line no-param-reassign
      upiShadow.length = 0; upiShadow.push(...Array.from(best.values()));
    })();

    // If there's any UPI record for a reference, hide the real wallet txn with that reference to avoid duplicates
  const allUpiRefs = new Set((upiDedupList || []).map(p => p && p.referenceId).filter(Boolean));
  const approvedUpis = upiDedupList.filter(p => ['APPROVED', 'CREDITED', 'PAID', 'SUCCESS'].includes(String(p.status || '').toUpperCase()));

    // Add Withdrawal request shadow items
    // Only include withdrawals that were submitted (after OTP verification) or finalized.
    const wdShadow = wdDisplay
      .filter(w => {
        const st = String(w.status || '').toUpperCase();
        // Exclude pre-OTP or canceled: CREATED, OTP_SENT, CANCELLED/CANCELED
        if (st === 'CREATED' || st === 'OTP_SENT' || st === 'CANCELLED' || st === 'CANCELED') return false;
        // Include: PENDING, PAID, REJECTED; also allow OTP_VERIFIED/VERIFIED/QUEUED/PROCESSING as pending
        return ['PENDING','PAID','REJECTED','OTP_VERIFIED','VERIFIED','QUEUED','PROCESSING'].includes(st);
      })
      // Only add a shadow if there is no real debit with the same reference yet
      .filter(w => {
        const ref = (w.referenceId && String(w.referenceId).trim()) || `WREQ_${w.id}`;
        return !realDebitRefs.has(ref);
      })
      .map(w => {
        const st = String(w.status || '').toUpperCase();
        const uiStatus = (st === 'PAID') ? 'PAID' : (st === 'REJECTED') ? 'REJECTED' : 'PENDING';
        return ({
          id: `wd-${w.id}`,
          type: 'DEBIT',
          amount: Number(w.amount || 0),
          description: `Withdrawal ${uiStatus === 'PENDING' ? '(Pending)' : uiStatus === 'PAID' ? '(Paid)' : '(Rejected)'} via ${w.method}${w.method === 'UPI' && w.upiId ? ` (${w.upiId})` : ''}${w.referenceId ? ` (Ref: ${w.referenceId})` : ''}`,
          referenceId: (w.referenceId && String(w.referenceId).trim().length > 0) ? w.referenceId : `WREQ_${w.id}`,
          // Again, never synthesize now(); keep null if unknown to avoid re-sorting flicker
          createdAt: w.createdAt || w.updatedAt || null,
          __withdrawalStatus: uiStatus
        });
      });

    // Exclude withdrawal shadows that already have a real transaction with same referenceId
  const wdShadowDeduped = wdShadow.filter(w => !existingRefs.has(w.referenceId));

  // Annotate real transactions with withdrawal/UPI status when applicable
  list = list.map(t => {
  // Annotate credited/pending UPI Add Money transactions
      if (t && t.referenceId && upiByRef.has(t.referenceId)) {
        const p = upiByRef.get(t.referenceId);
        const st = String(p.status || '').toUpperCase();
        if (st === 'APPROVED' || st === 'CREDITED' || st === 'PAID') {
          t = {
            ...t,
            __upiStatus: 'CREDITED',
    description: t.description || `UPI Add Money (Approved)`
          };
        } else if (st === 'SUBMITTED' || st === 'UTR_SUBMITTED') {
          t = {
            ...t,
            __upiStatus: 'PENDING',
            description: t.description || `UPI Add Money (Pending Verification)`
          };
        }
      }

      // Annotate refund credits for rejected withdrawals (referenceId starts with WRF_)
      if (t && t.type === 'CREDIT' && typeof t.referenceId === 'string' && t.referenceId.startsWith('WRF_')) {
        t = {
          ...t,
          __refundStatus: 'REFUNDED',
          description: t.description || 'Withdrawal Refund'
        };
      }

      if (t && t.referenceId && wdByRef.has(t.referenceId)) {
        const w = wdByRef.get(t.referenceId);
        const st = String(w.status || '').toUpperCase();
        const uiStatus = (st === 'PAID') ? 'PAID' : (st === 'REJECTED') ? 'REJECTED' : 'PENDING';
        const statusText = uiStatus === 'PENDING' ? '(Pending)' : uiStatus === 'PAID' ? '(Paid)' : '(Rejected)';
        const methodText = `via ${w.method}` + (w.method === 'UPI' && w.upiId ? ` (${w.upiId})` : '');
        return {
          ...t,
          __withdrawalStatus: uiStatus,
          description: t.description || `Withdrawal ${statusText} ${methodText}`
        };
      }

      // Annotate tournament registration entries with a simple status badge
      // Recognize by referenceId prefix TRN_ or description starting with "Tournament Registration"
      const looksLikeRegistration = (typeof t.referenceId === 'string' && t.referenceId.startsWith('TRN_'))
        || (/^Tournament Registration/i.test(String(t.description || '')));
      if (looksLikeRegistration) {
        let reg = null;
        // Try match by registrationId or matchId embedded in referenceId TRN_<matchId>_<registrationId>
        if (typeof t.referenceId === 'string' && t.referenceId.startsWith('TRN_')) {
          const parts = String(t.referenceId).split('_');
          const maybeRegId = parts.length >= 3 ? parts[2] : null;
          if (maybeRegId) {
            reg = (registrations || []).find(r => String(r.registrationId || r.id) === String(maybeRegId));
          }
          if (!reg && parts.length >= 2) {
            const maybeMatchId = parts[1];
            reg = (registrations || []).find(r => String(r.matchId || r.match?.id) === String(maybeMatchId));
          }
        }
        // Fallback: try exact title match
        if (!reg && t.description) {
          const title = String(t.description).replace('Tournament Registration - ', '').trim().toLowerCase();
          if (title) {
            reg = (registrations || []).find(r => String(r.match?.title || '').trim().toLowerCase() === title);
          }
        }
        const matchStatus = (reg && reg.match && reg.match.status) ? String(reg.match.status).toUpperCase() : null;
        let badge = 'CREATED';
        if (matchStatus === 'COMPLETED') badge = 'COMPLETED';
        else if (matchStatus === 'CANCELLED') badge = 'CANCELLED';
        t = { ...t, __registrationStatus: badge };
      }
      return t;
    });

    // Early filter: drop generic non‑UPI "Money Added/Added Money" credits entirely
    list = list.filter(t => {
      if (!t || t.type !== 'CREDIT') return true;
      const ref = String(t.referenceId || '');
      if (ref.startsWith('UPI_')) return true; // keep UPI
      if (ref.startsWith('WRF_') || ref.startsWith('PRIZE_')) return true; // keep refunds/prizes
      const desc = String(t.description || '').trim();
      if (/^UPI\s+Add\s+Money/i.test(desc)) return true; // keep explicit UPI labels
      if (/\bMoney\s*Added\b/i.test(desc)) return false;
      if (/\bAdded\s*Money\b/i.test(desc)) return false;
      if (/\bAdd\s*Money\b/i.test(desc) && !/UPI/i.test(desc)) return false;
      // If there's no description and it's not a known ref (UPI/WRF/PRIZE), drop it to avoid fallback 'Money Added'
      if (!desc) return false;
      return true;
    });

    // Drop real CREDIT rows that duplicate a pending/rejected UPI shadow entry
  if (allUpiRefs.size > 0) {
      list = list.filter(t => {
        if (!t || t.type !== 'CREDIT') return true;
        if (!t.referenceId) return true;
    // Hide any matching real credit when any UPI record exists (we will show the enriched UPI row instead)
    if (allUpiRefs.has(t.referenceId)) return false;
    return true;
      });
    }

  // Also hide generic 'UPI Add Money' credits (no ref) that correspond to any UPI payment in a near-time window
    if ((upiDedupList || []).length > 0) {
      list = list.filter(t => {
        if (!t || t.type !== 'CREDIT') return true;
        // already filtered by reference above; here target credits with no UPI ref
        const hasUpiRef = typeof t.referenceId === 'string' && t.referenceId.startsWith('UPI_');
        if (hasUpiRef) return true; // handled earlier
        // only consider rows that look like UPI entries
        if (!/^UPI\s+Add\s+Money/i.test(String(t.description || ''))) return true;
        const amt = Number(t.amount || 0);
        const ts = t.createdAt ? new Date(t.createdAt).getTime() : null;
        if (!amt || !ts) return true;
        // check if any UPI payment matches amount within +/- 10 minutes
        const match = (upiDedupList || []).some(p => {
          const pats = (p.updatedAt || p.createdAt) ? new Date(p.updatedAt || p.createdAt).getTime() : null;
          if (!pats) return false;
          return Number(p.amount || 0) === amt && Math.abs(ts - pats) <= 10 * 60 * 1000;
        });
        return !match; // drop if it matches
      });
    }

    // Finally, hide generic 'Money Added' rows entirely (non-UPI generic credits)
    list = list.filter(t => {
      if (!t || t.type !== 'CREDIT') return true;
      const desc = String(t.description || '').trim();
      if (/^Money Added\b/i.test(desc)) return false;
      return true;
    });

    list = [...upiShadow, ...wdShadowDeduped, ...list];

    // Final safety dedupe: ensure only one visible UPI row per payment
    (function finalDedupe() {
      const minuteOf = (ts) => { try { const d = new Date(ts); if (!isFinite(d.getTime())) return null; return d.toISOString().slice(0,16); } catch { return null; } };
      const pref = (s) => { const st = String(s||'').toUpperCase(); if (st==='CREDITED' || st==='APPROVED') return 3; if (st==='PENDING') return 2; if (st==='REJECTED') return 1; return 0; };
      const isUpiRow = (t) => /^(UPI\s+Add\s+Money)/i.test(String(t.description||''));
      const keyOf = (t) => {
        const mk = minuteOf(t.createdAt);
        const amt = Number(t.amount||0);
        // Group primarily by amount + minute to merge generic and UTR variants for the same payment instance
        if (mk && amt>0) return `B:${amt}|${mk}`;
        // Fallbacks
        if (t.referenceId && String(t.referenceId).startsWith('UPI_')) return `REF:${t.referenceId}`;
        const m = String(t.description||'').match(/UTR:\s*([A-Za-z0-9]+)/);
        if (m) return `UTR:${m[1]}`;
        return t.id;
      };
      const best = new Map();
      const others = [];
      list.forEach(t => {
        if (t.type !== 'CREDIT' || !isUpiRow(t)) { others.push(t); return; }
        const k = keyOf(t);
        const cur = best.get(k);
        // prefer higher status and presence of UTR in description
        const score = pref(t.__upiStatus) + (/\(UTR:/i.test(String(t.description||'')) ? 0.1 : 0);
        const curScore = cur ? pref(cur.__upiStatus) + (/\(UTR:/i.test(String(cur.description||'')) ? 0.1 : 0) : -1;
        if (!cur || score >= curScore) best.set(k, t);
      });
      const merged = [...others, ...Array.from(best.values())];
      list = merged; // overwrite local var for further filtering/sorting
    })();

    // Mirror UPI filtering: ensure we only show withdrawals that are pending/paid/rejected after OTP verification
    list = list.filter(t => {
      if (!t || t.type !== 'DEBIT') return true;
      const isWd = (/^Withdrawal/i.test(String(t.description||''))) || Boolean(t.__withdrawalStatus);
      if (!isWd) return true;
      const st = String(t.__withdrawalStatus || '').toUpperCase();
      return st === 'PENDING' || st === 'PAID' || st === 'REJECTED';
    });

    // Hard filter: remove any generic non‑UPI "Money Added" credit rows
    list = list.filter(t => {
      if (!t || t.type !== 'CREDIT') return true;
      const desc = String(t.description || '');
      // keep only explicit UPI entries; drop other generic money added credits
      if (/^UPI\s+Add\s+Money/i.test(desc)) return true;
      if (/\bMoney\s*Added\b/i.test(desc)) return false;
      if (/\bAdded\s*Money\b/i.test(desc)) return false;
      if (/\bAdd\s*Money\b/i.test(desc) && !/UPI/i.test(desc)) return false;
      // If description is empty and it's not UPI/refund/prize, drop it
      const ref = String(t.referenceId || '');
      if (!desc && !(ref.startsWith('UPI_') || ref.startsWith('WRF_') || ref.startsWith('PRIZE_'))) return false;
      return true;
    });

    // Apply filter by type
    if (transactionFilter === 'added') {
      // Show credits: money added (gateway/UPI), and refunds
      list = list.filter(t => t.type === 'CREDIT');
    } else if (transactionFilter === 'prizes' || transactionFilter === 'spent') {
      // Prize Credit: show only credits originating from prizes
      list = list.filter(t => {
        if (t?.type !== 'CREDIT') return false;
        const ref = String(t?.referenceId || '');
        if (ref.startsWith('PRIZE_')) return true;
        const reason = t?.meta && (t.meta.reason || t.meta.subreason);
        if (String(reason || '').toLowerCase().includes('prize')) return true;
        const desc = String(t?.description || '');
        return /prize\s*credit/i.test(desc);
      });
    } else if (transactionFilter === 'refunds') {
      // Refunds: show only refund credits
      list = list.filter(t => {
        if (t?.type !== 'CREDIT') return false;
        const ref = String(t?.referenceId || '');
        if (ref.startsWith('WRF_')) return true;
        const reason = t?.meta && (t.meta.reason || t.meta.subreason);
        if (String(reason || '').toLowerCase().includes('refund')) return true;
        const desc = String(t?.description || '');
        return /refund/i.test(desc);
      });
    } else if (transactionFilter === 'withdrawals') {
      // Show only withdrawals (real or shadow) by referenceId pattern or presence of withdrawal status
      list = list.filter(t => t.type === 'DEBIT' && (
        (typeof t.referenceId === 'string' && t.referenceId.startsWith('WREQ_')) ||
        Boolean(t.__withdrawalStatus)
      ));
    }

    // Sort newest first by createdAt; if missing, keep relative order
    list.sort((a, b) => {
      const ta = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return list;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    // Render in India Standard Time explicitly
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  if (!isOpen) return null;

  return (
    <div className="wallet-modal-overlay" onClick={onClose}>
      <div className="wallet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wallet-modal-header">
          <h2>My Wallet</h2>
          <p>Manage your PrimeArena wallet and transactions</p>
          <button className="wallet-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="wallet-content">
          {/* Wallet Balance Section */}
          <div className="wallet-balance-section">
            <div className="balance-card">
              <div className="balance-header">
                <div className="balance-icon">💳</div>
                <div className="balance-info">
                  <h3>Wallet Balance</h3>
                  <div className="balance-amount">₹{walletData.balance.toLocaleString('en-IN')}</div>
                  <p>Available for tournaments</p>
                </div>
                <div className="welcome-info">
                  <p>Welcome back,</p>
                  <span>{userData?.name || 'User'}</span>
                </div>
              </div>
            </div>


            {/* Action Buttons */}
            <div className="wallet-actions">
              <button className="add-money-btn" onClick={handleAddMoneyClick}>
                <span className="btn-icon">+</span>
                Add Money
              </button>
              <button className="withdraw-btn" onClick={() => setShowWithdrawModal(true)}>
                <span className="btn-icon">↓</span>
                Withdraw
              </button>
            </div>
          </div>

          {/* Statistics Cards */}
          <div className="wallet-stats">
            <div className="stat-card green">
              <div className="stat-value">₹{Number(walletData.trueTotalAdded || 0)}</div>
              <div className="stat-label">Total Added</div>
            </div>
            <div className="stat-card red">
              <div className="stat-value">₹{Number(walletData.profitTotal || 0)}</div>
              <div className="stat-label">Profit</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value">₹{Number(walletData.withdrawTotal || 0)}</div>
              <div className="stat-label">Withdraw</div>
            </div>
          </div>

          {/* Section Navigation */}
          <div className="section-navigation">
            <button 
              className={`section-btn ${activeSection === 'history' ? 'active' : ''}`}
              onClick={() => setActiveSection('history')}
            >
              Transaction History
            </button>
            <button 
              className={`section-btn ${activeSection === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveSection('analytics')}
            >
              📊 Analytics
            </button>
          </div>

          {/* Transaction History Section */}
          {activeSection === 'history' && (
            <div className="transaction-section">
              <div className="transaction-header">
                <h3>Transaction History</h3>
                <p>Only the last 10 days of transactions are available</p>
              </div>

              {/* Transaction Filters */}
              <div className="transaction-filters">
                <button 
                  className={`filter-btn ${transactionFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTransactionFilter('all')}
                >
                  All
                </button>
                <button 
                  className={`filter-btn ${transactionFilter === 'added' ? 'active' : ''}`}
                  onClick={() => setTransactionFilter('added')}
                >
                  Money Added
                </button>
                <button 
                  className={`filter-btn ${transactionFilter === 'refunds' ? 'active' : ''}`}
                  onClick={() => setTransactionFilter('refunds')}
                >
                  Refunds
                </button>
                <button 
                  className={`filter-btn ${transactionFilter === 'prizes' ? 'active' : ''}`}
                  onClick={() => setTransactionFilter('prizes')}
                >
                  Prize Credit
                </button>
                <button 
                  className={`filter-btn ${transactionFilter === 'withdrawals' ? 'active' : ''}`}
                  onClick={() => setTransactionFilter('withdrawals')}
                >
                  Withdrawals
                </button>
              </div>

              {/* Transaction List */}
              <div className="transaction-list">
                {isLoading ? (
                  <div className="loading-state">
                    <div className="spinner"></div>
                    <p>Loading transactions...</p>
                  </div>
                ) : getFilteredTransactions().length === 0 ? (
                  <div className="no-transactions">
                    <div className="no-transactions-icon">💳</div>
                    <h4>No Transactions Yet</h4>
                    <p>Start by adding money to your wallet</p>
                    <button className="add-money-cta" onClick={handleAddMoneyClick}>
                      Add Money
                    </button>
                  </div>
                ) : (
                  getFilteredTransactions().map((transaction) => {
                    // Try to extract tournament info if present
                    let tournamentTitle = '';
                    let tournamentDate = '';
                    // If transaction is a tournament entry or prize, try to find match info from registrations
                    if (transaction.referenceId && (transaction.referenceId.startsWith('TRN_') || transaction.referenceId.startsWith('PRIZE_'))) {
                      const reg = (registrations || []).find(r => {
                        // Match by registrationId or matchId in referenceId
                        const ref = String(transaction.referenceId);
                        return (
                          (r?.registrationId && ref.includes(String(r.registrationId))) ||
                          (r?.match?.id && ref.includes(String(r.match.id)))
                        );
                      });
                      if (reg && reg.match) {
                        tournamentTitle = reg.match.title || '';
                        tournamentDate = reg.match.scheduledAt ? formatDate(reg.match.scheduledAt) : '';
                      }
                    }
                    // Determine if this is a withdrawal-style item (real or shadow)
                    const refStr = String(transaction.referenceId || '');
                    const isWithdrawRef = refStr.startsWith('WREQ_') || refStr.startsWith('WTH_') || refStr.startsWith('WITH_');
                    const isWithdrawal = Boolean(
                      transaction.__withdrawalStatus ||
                      isWithdrawRef ||
                      (/^Withdrawal/i.test(String(transaction.description || ''))) ||
                      (transaction.type === 'DEBIT' && !refStr.startsWith('TRN_') && /withdraw/i.test(String(transaction.description || '')))
                    );
                    const isRefund = transaction.type === 'CREDIT' && refStr.startsWith('WRF_');
                    const isCreditType = transaction.type === 'CREDIT' && !refStr.startsWith('PRIZE_') && !refStr.startsWith('WRF_');

                    return (
                      <div key={transaction.id} className="transaction-item">
                        <div className="transaction-icon">
                          {transaction.type === 'CREDIT' ? '💰' : (isWithdrawal ? '🏦' : '🏆')}
                        </div>
                        <div className="transaction-details">
                          <div className="transaction-title">
                            {transaction.description || 
                              (transaction.type === 'CREDIT' ? 'Credit' : 'Tournament Entry')}
                          </div>
                          <div className="transaction-date">
                            {formatDate(transaction.createdAt)}
                            {tournamentTitle && (
                              <>
                                {' \u2022 '}
                                {tournamentTitle}
                                {tournamentDate ? ` — ${tournamentDate}` : ''}
                              </>
                            )}
                          </div>
                          {isCreditType && (
                            <div className="txn-type-chip credit" title="Credit transaction">ADDING MONEY</div>
                          )}
                          {isWithdrawal && (
                            <div className="txn-type-chip withdraw" title="Withdrawal transaction">WITHDRAWING MONEY</div>
                          )}
                          {isRefund && (
                            <div className="txn-type-chip refunded" title="Refund transaction">REFUND</div>
                          )}
                          {transaction.__upiStatus && (
                <div className={`txn-status-badge ${String(transaction.__upiStatus).toLowerCase()}`}>
                              {(() => {
                                const st = String(transaction.__upiStatus).toUpperCase();
                                if (st === 'UTR_SUBMITTED' || st === 'SUBMITTED' || st === 'PENDING') return 'PENDING';
                                if (st === 'APPROVED' || st === 'CREDITED' || st === 'PAID' || st === 'SUCCESS') return 'CREDITED';
                                if (st === 'REJECTED') return 'REJECTED';
                                return st;
                              })()}
                            </div>
                          )}
                          {!transaction.__upiStatus && transaction.__withdrawalStatus && (
                            <div className={`txn-status-badge ${String(transaction.__withdrawalStatus).toLowerCase()}`}>
                              {(() => {
                                const st = String(transaction.__withdrawalStatus).toUpperCase();
                                if (st === 'PENDING' || st === 'OTP_VERIFIED') return 'PENDING';
                                if (st === 'PAID') return 'PAID';
                                if (st === 'REJECTED') return 'REJECTED';
                                return st;
                              })()}
                            </div>
                          )}
                          {transaction.__refundStatus && (
                            <div className={`txn-status-badge refunded`}>
                              REFUNDED
                            </div>
                          )}
                          {!transaction.__upiStatus && transaction.__registrationStatus && (
                            <div className={`txn-status-badge ${String(transaction.__registrationStatus).toLowerCase()}`}>
                              {String(transaction.__registrationStatus)}
                            </div>
                          )}
                        </div>
                        <div className={`transaction-amount ${transaction.type.toLowerCase()}`}>
                          {transaction.type === 'CREDIT' ? '+' : '-'}₹{transaction.amount}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {!isLoading && getFilteredTransactions().length > 0 && hasMoreTx && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                  <button className="filter-btn" onClick={() => fetchTransactions({ append: true })}>Load more</button>
                </div>
              )}
            </div>
          )}

          {/* Analytics Section */}
          {activeSection === 'analytics' && (
            <div className="analytics-section">
              <div className="analytics-header">
                <h3>Wallet Analytics</h3>
                <p>Detailed insights into your spending patterns</p>
              </div>

              <div className="analytics-cards">
                <div className="analytics-card">
                  <h4>Earnings Breakdown</h4>
                  <div className="spending-item">
                    <span>Admin Prize Credits</span>
                    <span>₹{Number(walletData.profitTotal || 0)}</span>
                  </div>
                  <div className="spending-item">
                    <span>Withdrawals</span>
                    <span>₹{Number(walletData.withdrawTotal || 0)}</span>
                  </div>
                </div>

                <div className="analytics-card">
                  <h4>Monthly Summary</h4>
                  <div className="monthly-item">
                    <span>This Month Added</span>
                    <span className="positive">+₹{Number(walletData.trueTotalAdded || 0)}</span>
                  </div>
                  <div className="monthly-item">
                    <span>This Month Prize Earnings</span>
                    <span className="positive">+₹{Number(walletData.profitTotal || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Money Modal */}
      <AddMoneyModal
        isOpen={showAddMoneyModal}
        onClose={() => setShowAddMoneyModal(false)}
        onAddMoney={handleAddMoney}
      />

      {/* Withdraw Modal */}
  <WithdrawModal 
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        onWithdraw={handleWithdraw}
        currentBalance={walletData.balance}
      />
      
      <ProfileCompletionModal
        isOpen={showProfileCompletion}
        onClose={() => {
          setShowProfileCompletion(false);
          // Don't set profileCompleted to true here - only when actually completed
        }}
        onSubmit={handleProfileCompletion}
        userData={userData}
      />
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
export default WalletModal;
