'use client';
import { useEffect, useId, useRef } from 'react';
import Icon from './Icons';

export default function Modal({ title, children, onClose, closeDisabled = false, open = true, dismissOnBackdrop = true, footer }: { title: string; children: React.ReactNode; onClose: () => void; closeDisabled?: boolean; open?: boolean; dismissOnBackdrop?: boolean; footer?: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (open && !element?.open) element?.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  useEffect(() => () => { dialog.current?.close(); }, []);
  return <dialog ref={dialog} className={footer?'modal with-footer':'modal'} onCancel={event=>{event.preventDefault();if(!closeDisabled)onClose();}} onClick={event => { if (dismissOnBackdrop && !closeDisabled && event.target === dialog.current) onClose(); }} aria-labelledby={titleId}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Закрыть" disabled={closeDisabled} onClick={onClose}><Icon name="close"/></button></div>
    {footer?<><div className="modal-body">{children}</div><div className="modal-footer">{footer}</div></>:children}
  </dialog>;
}
