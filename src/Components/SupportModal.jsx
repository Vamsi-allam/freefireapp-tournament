import React, { useEffect, useState } from 'react';
import './SupportModal.css';
import { submitSupportRequest } from '../utils/api';
import { Snackbar, Alert } from '@mui/material';

const initialState = { email: '', phone: '', message: '' };

const SupportModal = ({ isOpen, onClose, defaultEmail = '', defaultPhone = '' }) => {
  const [form, setForm] = useState({ ...initialState });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'info' });

  const openSnack = (message, severity = 'info') => setSnack({ open: true, message, severity });
  const closeSnack = () => setSnack(s => ({ ...s, open: false }));

  useEffect(() => {
    if (isOpen) {
      setForm({ email: defaultEmail || '', phone: defaultPhone || '', message: '' });
      setErrors({});
    }
  }, [isOpen, defaultEmail, defaultPhone]);

  const validate = () => {
    const e = {};
    if (!form.email) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email';
    if (!form.phone) e.phone = 'Phone is required';
    else if (!/^\+?[0-9]{7,15}$/.test(form.phone)) e.phone = 'Enter a valid phone';
    if (!form.message || form.message.trim().length < 10) e.message = 'Please describe the issue (min 10 chars)';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      await submitSupportRequest({ ...form });
      openSnack("Thanks! Your support request has been submitted. We'll get back to you soon.", 'success');
      setTimeout(() => { onClose?.(); }, 1200);
    } catch (err) {
      console.error('Support submit failed:', err);
      openSnack(err?.message || 'Failed to submit support request. Please try again later.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="support-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title">
          <div className="support-header">
            <div className="support-title-wrap">
              <span className="support-icon" aria-hidden>🛟</span>
              <h2 id="support-title">Contact Support</h2>
            </div>
            <button className="support-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <p className="support-subtitle">Tell us your issue. Provide your email, phone, and a brief message.</p>

          <form className="support-form" onSubmit={handleSubmit} noValidate>
            <label className="support-label" htmlFor="support-email">Email</label>
            <input
              id="support-email"
              type="email"
              className={`support-input ${errors.email ? 'error' : ''}`}
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
              required
            />
            {errors.email && <div className="support-error">{errors.email}</div>}

            <label className="support-label" htmlFor="support-phone">Phone</label>
            <input
              id="support-phone"
              type="tel"
              className={`support-input ${errors.phone ? 'error' : ''}`}
              placeholder="e.g. +91 1234567890"
              value={form.phone}
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
              required
            />
            {errors.phone && <div className="support-error">{errors.phone}</div>}

            <label className="support-label" htmlFor="support-message">Message</label>
            <textarea
              id="support-message"
              className={`support-textarea ${errors.message ? 'error' : ''}`}
              placeholder="Describe the problem you're facing"
              rows={5}
              value={form.message}
              onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
              required
            />
            {errors.message && <div className="support-error">{errors.message}</div>}

            <div className="support-actions">
              <button type="button" className="btn-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        </div>
      </div>

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
    </>
  );
};

export default SupportModal;
