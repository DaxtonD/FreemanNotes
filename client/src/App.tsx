import React from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import AuthGate from "./components/AuthGate";
import { AuthProvider } from "./authContext";

/**
 * Phase 1 app shell.
 * Now wraps the app in `AuthProvider` so auth UI can be added.
 */
export default function App(): JSX.Element {
	return (
		<AuthProvider>
			<div className="app-root">
				<Header />
				<div className="app-body">
					<Sidebar />
					<main className="main-area">
						<AuthGate />
					</main>
				</div>
			</div>
		</AuthProvider>
	);
}
