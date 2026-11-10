'use client';
import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';

export default function Auth({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signup = mode === 'sign-up';
  const [emailForm, setEmailForm] = useState(false);
  const [dialog, setDialog] = useState('');
  const [email, setEmail] = useState('');
  const action = signup ? 'Регистрация' : 'Вход';
  return <main id="maincontent" className="auth-main">
    <div className={`auth-card ${signup ? 'signup' : 'signin'}`}>
      <header className="auth-header">
        <a href="/reader/" className="wordmark" aria-label="SmartReader — открыть читалку"><span className="wordmark-bars"/><strong>SmartReader</strong></a>
        <div className="auth-intro">
          <h1>{signup ? 'Читайте и слушайте свои статьи.' : 'Вернитесь к чтению.'}</h1>
          {signup ? <>
            <div className="format-tags" aria-hidden="true">{['TXT','Markdown','Аудио','JSON'].map(t=><span key={t}>{t}</span>)}</div>
            <ul className="benefits">
              {['Текст и ваша озвучка в одном окне','Подсветка слов и переход по тексту','Сохранение материала в этом браузере'].map(t=><li key={t}><Icon name="check" size={14}/>{t}</li>)}
            </ul>
          </> : <p className="auth-subtitle">Ваш текст, аудио и сохранённая позиция.</p>}
          <p className="auth-subtitle">Локальный режим без аккаунта. Облачный вход пока не подключён.</p>
        </div>
      </header>
      <div className="social-buttons">
        <button className="auth-button google" onClick={()=>setDialog('Вход через Google')}><span className="google-symbol" aria-hidden="true">G</span>{action} через Google</button>
        <button className="auth-button apple" onClick={()=>setDialog('Вход через Apple')}><span className="apple-symbol" aria-hidden="true">●<i/></span>{action} через Apple</button>
        {signup && <p className="terms">Загружайте материалы, которые вправе использовать.<br/><button onClick={()=>setDialog('Условия использования')}>Условия использования</button> и <button onClick={()=>setDialog('Конфиденциальность')}>конфиденциальность</button>.<br/>Текст и аудиофайлы хранятся в вашем браузере.</p>}
      </div>
      <button className="auth-button email" onClick={()=>setEmailForm(v=>!v)} aria-expanded={emailForm}>{emailForm ? 'Другие варианты' : `${action} через email`}</button>
      {emailForm && <form className="email-form" onSubmit={e=>{e.preventDefault();setDialog('Локальный режим');}}>
        <p>Облачная регистрация пока не подключена. Читалкой можно пользоваться без аккаунта.</p>
        <label>Email<input autoFocus required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
        <button className="primary-button" type="submit">Продолжить</button>
      </form>}
      <footer className="auth-footer"><span>{signup ? 'Уже зарегистрированы?' : 'Впервые здесь?'}</span><a href={signup ? '/reader/sign-in/' : '/reader/sign-up/'}>{signup ? 'Войти' : 'Регистрация'}</a></footer>
      <a className="reader-entry" href="/reader/">Открыть читалку без регистрации <span aria-hidden="true">→</span></a>
      <a className="publication-entry" href="/reader/?publish=1">Озвучка статей для вашего сайта →</a>
    </div>
    {dialog && <Modal title={dialog} onClose={()=>setDialog('')}>
      {dialog === 'Конфиденциальность' ? <p>Текст, аудио и прогресс хранятся в вашем браузере. Файлы не отправляются на сервер. Очистка данных браузера удалит сохранённые материалы.</p> : dialog === 'Условия использования' ? <p>Загружайте материалы, которые вы вправе использовать. Эта читалка работает локально и не создаёт облачный аккаунт.</p> : <p>В этой версии доступен локальный просмотрщик. Вход через внешние сервисы ещё не подключён; можно сразу перейти к чтению и загрузить свои материалы.</p>}
      <a href="/reader/" className="primary-button">Открыть читалку <Icon name="arrow" size={18}/></a>
    </Modal>}
  </main>;
}
