import React, { useEffect } from 'react';
import './Snackbar.css';

const Snackbar = ({ open, message, type = 'info', onClose, autoHideDuration = 3000 }) => {
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      onClose?.();
    }, autoHideDuration);
    return () => clearTimeout(id);
  }, [open, autoHideDuration, onClose]);

  if (!open) return null;

  return (
    <div className={`snackbar snackbar-${type}`} role="status" aria-live="polite" onClick={onClose}>
      {message}
    </div>
  );
};

export default Snackbar;
