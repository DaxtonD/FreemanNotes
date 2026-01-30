import React from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import NotesGrid from "./components/NotesGrid";
import AuthGate from "./components/AuthGate";
import { AuthProvider } from "./authContext";

/**
 * Phase 1 app shell.
 * Now wraps the app in `AuthProvider` so auth UI can be added.
 */
export default function App(): JSX.Element {
	const [selectedLabelIds, setSelectedLabelIds] = React.useState<number[]>([]);
	const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
	const toggleLabel = (id: number) => {
		setSelectedLabelIds((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
	};
	const clearLabels = () => setSelectedLabelIds([]);
	return (
		<AuthProvider>
			<div className="app-root">
				<Header onToggleSidebar={() => setSidebarCollapsed(c => !c)} />
				<div className="app-body">
					<Sidebar selectedLabelIds={selectedLabelIds} onToggleLabel={toggleLabel} onClearLabels={clearLabels} collapsed={sidebarCollapsed} />
					<main className="main-area">
						{/* AuthGate renders NotesGrid when authenticated; pass filters via context-like props */}
						{/* To keep AuthGate logic intact, duplicate NotesGrid for filter support within gate */}
						<AuthGate selectedLabelIds={selectedLabelIds} />
						{/* Fallback direct grid (optional): <NotesGrid selectedLabelIds={selectedLabelIds} /> */}
					</main>
				</div>
			</div>
		</AuthProvider>
	);
}
