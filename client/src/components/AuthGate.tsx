import React, { useState, useEffect } from 'react';
import { useAuth } from '../authContext';
import NotesGrid from './NotesGrid';
import RegisterModal from './RegisterModal';
import LoginModal from './LoginModal';

export default function AuthGate({ selectedLabelIds }: { selectedLabelIds?: number[] }) {
  const { user } = useAuth();
  const [showRegister, setShowRegister] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(d => setRegistrationEnabled(Boolean(d.userRegistrationEnabled)))
      .catch(() => setRegistrationEnabled(false));
  }, []);

  if (user) return <NotesGrid selectedLabelIds={selectedLabelIds || []} />;

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <h2>Welcome to FreemanNotes</h2>
      <p>Please sign in to view and manage your notes.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={() => setShowLogin(true)}>Sign in</button>
        {registrationEnabled && <button className="btn" onClick={() => setShowRegister(true)}>Create account</button>}
      </div>
      {showRegister && <RegisterModal onClose={() => setShowRegister(false)} />}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  );
}
