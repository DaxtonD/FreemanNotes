import React from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import AuthGate from "./components/AuthGate";
import { AuthProvider, useAuth } from "./authContext";
import { ThemeProvider } from "./themeContext";
import { DEFAULT_SORT_CONFIG, SortConfig } from './sortTypes';

/**
 * Phase 1 app shell.
 * Now wraps the app in `AuthProvider` so auth UI can be added.
 */
export default function App(): JSX.Element {
	return (
		<ThemeProvider>
			<AuthProvider>
				<AppShell />
			</AuthProvider>
		</ThemeProvider>
	);
}

function AppShell(): JSX.Element {
	const { user } = useAuth();
	const [selectedLabelIds, setSelectedLabelIds] = React.useState<number[]>([]);
	const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
	const [searchQuery, setSearchQuery] = React.useState('');
	const [sortConfig, setSortConfig] = React.useState<SortConfig>(DEFAULT_SORT_CONFIG);
	const toggleLabel = (id: number) => {
		setSelectedLabelIds((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
	};
	const clearLabels = () => setSelectedLabelIds([]);

	if (!user) {
		return (
			<div className="app-root" style={{ minHeight: '100vh' }}>
				<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<AuthGate />
				</div>
			</div>
		);
	}

	return (
		<div className="app-root">
			<Header onToggleSidebar={() => setSidebarCollapsed(c => !c)} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
			<div className="app-body">
				<Sidebar
					selectedLabelIds={selectedLabelIds}
					onToggleLabel={toggleLabel}
					onClearLabels={clearLabels}
					collapsed={sidebarCollapsed}
					sortConfig={sortConfig}
					onSortConfigChange={setSortConfig}
				/>
				<main className="main-area">
					<AuthGate selectedLabelIds={selectedLabelIds} searchQuery={searchQuery} sortConfig={sortConfig} />
				</main>
			</div>
		</div>
	);
}
