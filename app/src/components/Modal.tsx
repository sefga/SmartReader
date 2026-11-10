'use client';
import { useEffect, useRef } from 'react';
import Icon from './Icons';

export default function Modal({ title, children, onClose, closeDisabled = false }: { title: string; children: React.ReactNode; onClose: () => void; closeDisabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="modal" onCancel={event=>{event.preventDefault();if(!closeDisabled)onClose();}} onClick={e => { if (!closeDisabled && e.target === dialog.current) onClose(); }} aria-labelledby="dialog-title">
    <div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Закрыть" disabled={closeDisabled} onClick={onClose}><Icon name="close"/></button></div>
    {children}
  </dialog>;
}
