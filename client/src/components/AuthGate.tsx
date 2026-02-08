import React, { useState, useEffect } from 'react';
import { useAuth } from '../authContext';
import NotesGrid from './NotesGrid';
import RegisterModal from './RegisterModal';
import LoginModal from './LoginModal';
import type { SortConfig } from '../sortTypes';

export default function AuthGate({
  selectedLabelIds,
  selectedCollectionId,
  collectionStack,
  selectedCollaboratorId,
  searchQuery,
  sortConfig,
  onClearAllFilters,
  onSetSelectedLabelIds,
  onSetSelectedCollaboratorId,
  onSelectCollectionById,
  onSetCollectionStack,
  onSetSearchQuery,
  onSortConfigChange,
}: {
  selectedLabelIds?: number[];
  selectedCollectionId?: number | null;
  collectionStack?: Array<{ id: number; name: string }>;
  selectedCollaboratorId?: number | null;
  searchQuery?: string;
  sortConfig?: SortConfig;
  onClearAllFilters?: () => void;
  onSetSelectedLabelIds?: (ids: number[]) => void;
  onSetSelectedCollaboratorId?: (id: number | null) => void;
  onSelectCollectionById?: (collectionId: number, fallbackName?: string) => void;
  onSetCollectionStack?: (next: Array<{ id: number; name: string }>) => void;
  onSetSearchQuery?: (q: string) => void;
  onSortConfigChange?: (next: SortConfig) => void;
}) {
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

  if (user) return (
    <NotesGrid
      selectedLabelIds={selectedLabelIds || []}
      selectedCollectionId={selectedCollectionId ?? null}
      collectionStack={collectionStack || []}
      selectedCollaboratorId={selectedCollaboratorId ?? null}
      searchQuery={searchQuery}
      sortConfig={sortConfig}
      onClearAllFilters={onClearAllFilters}
      onSetSelectedLabelIds={onSetSelectedLabelIds}
      onSetSelectedCollaboratorId={onSetSelectedCollaboratorId}
      onSelectCollectionById={onSelectCollectionById}
      onSetCollectionStack={onSetCollectionStack}
      onSetSearchQuery={onSetSearchQuery}
      onSortConfigChange={onSortConfigChange}
    />
  );

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
