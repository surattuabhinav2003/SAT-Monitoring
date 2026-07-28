import Modal from './Modal.jsx';
import './ConfirmDialog.css';

/**
 * Confirmation dialog built on top of the generic Modal.
 * Used before destructive actions such as deleting an application.
 */
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} width={440}>
      <p className="confirm-message">{message}</p>
      <div className="confirm-actions">
        <button className="btn btn--ghost" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </button>
        <button
          className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
